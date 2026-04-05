import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import { CampaignReport } from '../evaluation/types';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';

dotenv.config();

export type LLMSummary = {
  generatedAt: Date;
  model: string;
  summary: string;
  criticalCampaigns: Array<{ id: string; name: string; metric: number; action: string }>;
  warningCount: number;
  warningDetails?: Array<{ name: string; metric: number; note: string }>;
  recommendedActions: string[];
  kpis?: {
    bestCampaign: string;
    worstCampaign: string;
    avgMetric: number;
    riskLevel: string;
  };
  rawResponse?: unknown;
};

type ParsedLLMResponse = Omit<LLMSummary, 'generatedAt' | 'model' | 'rawResponse'>;

async function callLLM(userPrompt: string): Promise<{ content: string; model: string }> {
  const provider = process.env.LLM_PROVIDER ?? 'openrouter';

  if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL ?? 'mistralai/mistral-7b-instruct';
    if (!apiKey) throw new Error('OPENROUTER_API_KEY no configurada');

    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }], temperature: 0.2 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    return { content: res.data.choices[0].message.content as string, model };
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');

    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    return { content: res.data.content[0].text as string, model: 'claude-haiku-4-5-20251001' };
  }

  throw new Error(`LLM_PROVIDER no soportado: ${provider}`);
}

export async function generateCampaignSummary(reports: CampaignReport[]): Promise<LLMSummary> {
  const generatedAt = new Date();

  try {
    const { content, model } = await callLLM(buildUserPrompt(reports));

    try {
      const cleaned = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as ParsedLLMResponse;
      return { generatedAt, model, ...parsed };
    } catch {
      return { generatedAt, model, summary: content, criticalCampaigns: [], warningCount: 0, recommendedActions: [], rawResponse: content };
    }
  } catch (err) {
    console.error('[LLM] Error:', (err as Error).message);
    return {
      generatedAt,
      model: process.env.OPENROUTER_MODEL ?? 'unknown',
      summary: `Error al generar resumen: ${(err as Error).message}`,
      criticalCampaigns: [],
      warningCount: 0,
      recommendedActions: [],
    };
  }
}

function drawSectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown();
  doc.fontSize(14).fillColor('#1a1a2e').text(title, { underline: true });
  doc.moveDown(0.3);
}

function drawMetricBadge(doc: PDFKit.PDFDocument, label: string, value: string, color: string): void {
  doc.fontSize(9).fillColor('#666').text(label + ': ', { continued: true });
  doc.fillColor(color).text(value);
}

function generatePDF(result: LLMSummary, reports: CampaignReport[]): string {
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const pdfPath = path.join(dataDir, 'campaign-report.pdf');

  const doc = new PDFDocument({ 
    margin: 50, 
    size: 'A4',
    info: { Title: 'Campaign Monitor - Resumen Ejecutivo', Author: 'Campaign Monitor System' }
  });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - 100;
  const stats = {
    total: reports.length,
    ok: reports.filter(r => r.status === 'ok').length,
    warning: reports.filter(r => r.status === 'warning').length,
    critical: reports.filter(r => r.status === 'critical').length,
    avgMetric: reports.reduce((sum, r) => sum + r.metric, 0) / reports.length,
  };

  doc.rect(40, 40, doc.page.width - 80, 80).fill('#1a1a2e');
  doc.fontSize(24).fillColor('white').text('Campaign Monitor', 50, 55, { width: pageWidth, align: 'center' });
  doc.fontSize(12).text('Resumen Ejecutivo', 50, 85, { width: pageWidth, align: 'center' });
  doc.fontSize(9).text(result.generatedAt.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }), 50, 105, { width: pageWidth, align: 'center' });
  doc.fillColor('black');
  doc.y = 140;

  doc.fontSize(10).fillColor('#666').text(`Modelo: ${result.model}`, { align: 'right' });
  doc.moveDown(1.5);

  doc.fontSize(18).fillColor('#1a1a2e').text('Resumen Ejecutivo', 50, doc.y, { width: pageWidth });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#333').text(result.summary, { width: pageWidth, lineGap: 4, paragraphGap: 8 });
  doc.moveDown();

  doc.fontSize(14).fillColor('#1a1a2e').text('Métricas del Portafolio', 50, doc.y, { width: pageWidth });
  doc.moveDown(0.5);
  
  const metricsY = doc.y;
  const boxWidth = 120;
  const boxGap = 20;
  const startX = 50;

  doc.rect(startX, metricsY, boxWidth, 50).fillAndStroke('#e8f5e9', '#4caf50');
  doc.fontSize(20).fillColor('#2e7d32').text(String(stats.ok), startX, metricsY + 8, { width: boxWidth, align: 'center' });
  doc.fontSize(9).text('OK', startX, metricsY + 32, { width: boxWidth, align: 'center' });

  doc.rect(startX + boxWidth + boxGap, metricsY, boxWidth, 50).fillAndStroke('#fff3e0', '#ff9800');
  doc.fontSize(20).fillColor('#e65100').text(String(stats.warning), startX + boxWidth + boxGap, metricsY + 8, { width: boxWidth, align: 'center' });
  doc.fontSize(9).text('Warning', startX + boxWidth + boxGap, metricsY + 32, { width: boxWidth, align: 'center' });

  doc.rect(startX + (boxWidth + boxGap) * 2, metricsY, boxWidth, 50).fillAndStroke('#ffebee', '#f44336');
  doc.fontSize(20).fillColor('#c62828').text(String(stats.critical), startX + (boxWidth + boxGap) * 2, metricsY + 8, { width: boxWidth, align: 'center' });
  doc.fontSize(9).text('Critical', startX + (boxWidth + boxGap) * 2, metricsY + 32, { width: boxWidth, align: 'center' });

  doc.y = metricsY + 65;
  doc.fontSize(10).fillColor('#333').text(`Total campañas: ${stats.total} | Métrica promedio: ${stats.avgMetric.toFixed(4)}`);
  doc.moveDown();

  if (result.criticalCampaigns.length > 0) {
    doc.moveDown();
    doc.fontSize(14).fillColor('#1a1a2e').text('Campañas Críticas - Acción Requerida', 50, doc.y, { width: pageWidth });
    doc.moveDown(0.5);
    result.criticalCampaigns.forEach(c => {
      const cardY = doc.y;
      doc.rect(50, cardY, pageWidth, 50).fillAndStroke('#ffebee', '#f44336');
      doc.fillColor('#c62828').fontSize(12).text(c.name, 60, cardY + 8, { width: pageWidth - 20 });
      doc.fillColor('#333').fontSize(9).text(`Métrica: ${c.metric.toFixed(4)}`, 60, cardY + 25, { width: pageWidth - 20 });
      doc.fillColor('#666').fontSize(9).text(`Acción: ${c.action}`, 60, cardY + 38, { width: pageWidth - 20 });
      doc.y = cardY + 60;
    });
  }

  if (result.recommendedActions.length > 0) {
    doc.moveDown();
    doc.fontSize(14).fillColor('#1a1a2e').text('Acciones Recomendadas', 50, doc.y, { width: pageWidth });
    doc.moveDown(0.5);
    result.recommendedActions.forEach((a, i) => {
      doc.fontSize(10).fillColor('#1a1a2e').text(`${i + 1}.`, 60, doc.y, { continued: true, width: 20 });
      doc.fillColor('#333').text(` ${a}`, { width: pageWidth - 30, indent: 10 });
      doc.moveDown(0.3);
    });
    doc.moveDown();
  }

  doc.moveDown();
  doc.fontSize(14).fillColor('#1a1a2e').text('Detalle de Campañas', 50, doc.y, { width: pageWidth });
  doc.moveDown(0.5);
  
  const tableTop = doc.y;
  const colWidths = [70, 90, 60, 280];
  const headers = ['Status', 'Métrica', 'ID', 'Nombre'];
  
  doc.rect(50, tableTop, pageWidth, 20).fill('#1a1a2e');
  doc.fontSize(9).fillColor('white');
  let xPos = 55;
  headers.forEach((h, i) => {
    doc.text(h, xPos, tableTop + 5, { width: colWidths[i] });
    xPos += colWidths[i];
  });
  
  let rowY = tableTop + 25;
  reports.forEach((r, index) => {
    if (rowY > doc.page.height - 100) {
      doc.addPage();
      rowY = 50;
    }
    
    const bgColor = index % 2 === 0 ? '#f5f5f5' : 'white';
    doc.rect(50, rowY, pageWidth, 18).fill(bgColor);
    
    const statusColor = r.status === 'critical' ? '#c62828' : r.status === 'warning' ? '#e65100' : '#2e7d32';
    const statusBg = r.status === 'critical' ? '#ffcdd2' : r.status === 'warning' ? '#ffe0b2' : '#c8e6c9';
    
    doc.rect(55, rowY + 2, 60, 14).fill(statusBg);
    doc.fontSize(8).fillColor(statusColor).text(r.status.toUpperCase(), 57, rowY + 4, { width: 56, align: 'center' });
    
    doc.fillColor('#333').fontSize(8);
    doc.text(r.metric.toFixed(4), 125, rowY + 4, { width: 80 });
    doc.text(r.id, 215, rowY + 4, { width: 50 });
    doc.text(r.name, 275, rowY + 4, { width: 250 });
    
    rowY += 18;
  });

  doc.end();

  return pdfPath;
}

if (require.main === module) {
  const reportPath = path.join(process.cwd(), 'data', 'last-report.json');
  if (!fs.existsSync(reportPath)) {
    console.error('[LLM] No existe data/last-report.json. Corre npm run evaluate primero.');
    process.exit(1);
  }

  const reports = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as CampaignReport[];

  generateCampaignSummary(reports).then((result) => {
    if (process.argv.includes('--structured')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n=== Resumen Ejecutivo ===');
      console.log(result.summary);
      if (result.criticalCampaigns.length > 0) {
        console.log('\nCampañas críticas:');
        result.criticalCampaigns.forEach(c => console.log(`  - ${c.name}: ${c.action}`));
      }
      console.log('\nAcciones recomendadas:');
      result.recommendedActions.forEach(a => console.log(`  • ${a}`));
    }

    const summaryPath = path.join(process.cwd(), 'data', 'last-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2));
    console.log('\n[File] Guardado en data/last-summary.json');

    const pdfPath = generatePDF(result, reports);
    console.log(`[File] PDF generado en ${pdfPath}`);
  });
}
