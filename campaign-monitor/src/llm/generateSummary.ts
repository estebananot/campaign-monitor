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

  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const stats = {
    total: reports.length,
    ok: reports.filter(r => r.status === 'ok').length,
    warning: reports.filter(r => r.status === 'warning').length,
    critical: reports.filter(r => r.status === 'critical').length,
    avgMetric: reports.reduce((sum, r) => sum + r.metric, 0) / reports.length,
  };

  const pageWidth = doc.page.width - 100;
  const leftMargin = 50;

  doc.rect(0, 0, doc.page.width, 90).fill('#2c3e50');
  doc.fontSize(26).fillColor('#ffffff').text('Campaign Monitor', leftMargin, 25, { width: pageWidth, align: 'center' });
  doc.fontSize(12).fillColor('#bdc3c7').text('Resumen Ejecutivo de Campañas', leftMargin, 55, { width: pageWidth, align: 'center' });
  doc.fontSize(9).text(result.generatedAt.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }), leftMargin, 72, { width: pageWidth, align: 'center' });
  doc.y = 110;

  doc.fontSize(9).fillColor('#7f8c8d').text(`Generado por: ${result.model}`, { align: 'right' });
  doc.moveDown(2);

  doc.fontSize(16).fillColor('#2c3e50').text('Resumen Ejecutivo');
  doc.moveTo(leftMargin, doc.y + 2).lineTo(leftMargin + pageWidth, doc.y + 2).lineWidth(2).stroke('#3498db');
  doc.moveDown(0.8);
  doc.fontSize(11).fillColor('#2c3e50').text(result.summary, { lineGap: 4, width: pageWidth });
  doc.moveDown(1.5);

  doc.fontSize(16).fillColor('#2c3e50').text('Métricas del Portafolio');
  doc.moveTo(leftMargin, doc.y + 2).lineTo(leftMargin + pageWidth, doc.y + 2).lineWidth(2).stroke('#3498db');
  doc.moveDown(0.8);

  const metricsY = doc.y;
  const boxW = 130;
  const boxH = 55;
  const gap = 15;
  const startX = leftMargin;

  doc.roundedRect(startX, metricsY, boxW, boxH, 5).fillAndStroke('#eafaf1', '#27ae60');
  doc.fontSize(24).fillColor('#27ae60').text(String(stats.ok), startX, metricsY + 8, { width: boxW, align: 'center' });
  doc.fontSize(9).fillColor('#1e8449').text('OK', startX, metricsY + 36, { width: boxW, align: 'center' });

  doc.roundedRect(startX + boxW + gap, metricsY, boxW, boxH, 5).fillAndStroke('#fef9e7', '#f39c12');
  doc.fontSize(24).fillColor('#f39c12').text(String(stats.warning), startX + boxW + gap, metricsY + 8, { width: boxW, align: 'center' });
  doc.fontSize(9).fillColor('#d68910').text('WARNING', startX + boxW + gap, metricsY + 36, { width: boxW, align: 'center' });

  doc.roundedRect(startX + (boxW + gap) * 2, metricsY, boxW, boxH, 5).fillAndStroke('#fdedec', '#e74c3c');
  doc.fontSize(24).fillColor('#e74c3c').text(String(stats.critical), startX + (boxW + gap) * 2, metricsY + 8, { width: boxW, align: 'center' });
  doc.fontSize(9).fillColor('#c0392b').text('CRITICAL', startX + (boxW + gap) * 2, metricsY + 36, { width: boxW, align: 'center' });

  doc.y = metricsY + boxH + 15;
  doc.fontSize(10).fillColor('#5d6d7e');
  doc.text(`Total de campañas analizadas: ${stats.total}    |    Métrica promedio: ${stats.avgMetric.toFixed(4)}`);
  doc.moveDown(1.5);

  if (result.criticalCampaigns.length > 0) {
    doc.fontSize(16).fillColor('#2c3e50').text('Campañas Críticas');
    doc.moveTo(leftMargin, doc.y + 2).lineTo(leftMargin + pageWidth, doc.y + 2).lineWidth(2).stroke('#e74c3c');
    doc.moveDown(0.8);
    result.criticalCampaigns.forEach(c => {
      const cardY = doc.y;
      doc.roundedRect(leftMargin, cardY, pageWidth, 60, 4).fillAndStroke('#fdedec', '#e74c3c');
      doc.fontSize(12).fillColor('#c0392b').text(c.name, leftMargin + 12, cardY + 8, { width: pageWidth - 24 });
      doc.fontSize(9).fillColor('#7b241c').text(`Métrica: ${c.metric.toFixed(4)}`, leftMargin + 12, cardY + 26, { width: pageWidth - 24 });
      doc.fontSize(9).fillColor('#922b21').text(`Acción recomendada: ${c.action}`, leftMargin + 12, cardY + 40, { width: pageWidth - 24 });
      doc.y = cardY + 70;
    });
    doc.moveDown(0.5);
  }

  if (result.recommendedActions.length > 0) {
    doc.fontSize(16).fillColor('#2c3e50').text('Acciones Recomendadas');
    doc.moveTo(leftMargin, doc.y + 2).lineTo(leftMargin + pageWidth, doc.y + 2).lineWidth(2).stroke('#3498db');
    doc.moveDown(0.8);
    result.recommendedActions.forEach((a, i) => {
      doc.fontSize(11).fillColor('#2c3e50').text(`${i + 1}.`, leftMargin, doc.y, { continued: true, width: 25 });
      doc.fillColor('#34495e').text(` ${a}`, { width: pageWidth - 25 });
      doc.moveDown(0.5);
    });
    doc.moveDown(1);
  }

  doc.fontSize(16).fillColor('#2c3e50').text('Detalle de Campañas');
  doc.moveTo(leftMargin, doc.y + 2).lineTo(leftMargin + pageWidth, doc.y + 2).lineWidth(2).stroke('#3498db');
  doc.moveDown(0.8);

  const colW = [100, 80, pageWidth - 180];
  const headers = ['Estado', 'Métrica', 'Nombre'];

  doc.rect(leftMargin, doc.y, pageWidth, 22).fill('#2c3e50');
  doc.fontSize(9).fillColor('#ffffff');
  let hX = leftMargin + 8;
  headers.forEach((h, i) => {
    doc.text(h, hX, doc.y - 16, { width: colW[i] });
    hX += colW[i];
  });
  doc.y += 5;

  reports.forEach((r, idx) => {
    if (doc.y > doc.page.height - 60) {
      doc.addPage();
      doc.y = 50;
    }
    const rowY = doc.y;
    const bg = idx % 2 === 0 ? '#f8f9f9' : '#ffffff';
    doc.rect(leftMargin, rowY, pageWidth, 20).fill(bg);

    const statusColors: Record<string, { bg: string; text: string }> = {
      ok: { bg: '#eafaf1', text: '#27ae60' },
      warning: { bg: '#fef9e7', text: '#f39c12' },
      critical: { bg: '#fdedec', text: '#e74c3c' },
    };
    const sc = statusColors[r.status];

    doc.roundedRect(leftMargin + 5, rowY + 3, 75, 14, 3).fill(sc.bg);
    doc.fontSize(8).fillColor(sc.text).text(r.status.toUpperCase(), leftMargin + 5, rowY + 5, { width: 75, align: 'center' });

    doc.fontSize(9).fillColor('#2c3e50').text(r.metric.toFixed(4), leftMargin + colW[0] + 8, rowY + 4, { width: colW[1] });
    doc.text(r.name, leftMargin + colW[0] + colW[1] + 8, rowY + 4, { width: colW[2] });

    doc.y = rowY + 20;
  });

  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#95a5a6').text(
      `Página ${i + 1} de ${pageCount}`,
      0, doc.page.height - 30,
      { width: doc.page.width, align: 'center' }
    );
  }

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
