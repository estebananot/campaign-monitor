import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import { CampaignReport } from '../evaluation/types';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';

dotenv.config();

async function sendSummaryToDiscord(result: LLMSummary, pdfPath: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn('[Discord] DISCORD_WEBHOOK_URL no configurado, omitiendo envío');
    return;
  }

  let message = `📊 **Resumen Ejecutivo - Campaign Monitor**\n\n`;
  message += `${result.summary}\n\n`;
  
  if (result.criticalCampaigns.length > 0) {
    message += `🚨 **Campañas Críticas:**\n`;
    result.criticalCampaigns.forEach(c => {
      message += `• ${c.name} (${c.metric.toFixed(4)}): ${c.action}\n`;
    });
    message += `\n`;
  }
  
  if (result.recommendedActions.length > 0) {
    message += `💡 **Acciones Recomendadas:**\n`;
    result.recommendedActions.forEach((a, i) => {
      message += `${i + 1}. ${a}\n`;
    });
  }

  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    
    const pdfBuffer = fs.readFileSync(pdfPath);
    form.append('payload_json', JSON.stringify({ content: message.substring(0, 2000) }));
    form.append('files[0]', pdfBuffer, { filename: 'campaign-report.pdf', contentType: 'application/pdf' });

    await axios.post(webhookUrl, form, { headers: form.getHeaders(), timeout: 10000 });
    console.log('[Discord] Resumen y PDF enviados al canal');
  } catch (err) {
    console.error('[Discord] Error al enviar:', (err as Error).message);
  }
}

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
    autoFirstPage: true,
    bufferPages: false
  });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const stats = {
    total: reports.length,
    ok: reports.filter(r => r.status === 'ok').length,
    warning: reports.filter(r => r.status === 'warning').length,
    critical: reports.filter(r => r.status === 'critical').length,
    avgMetric: reports.reduce((sum, r) => sum + r.metric, 0) / reports.length,
  };

  doc.fontSize(20).text('Campaign Monitor - Resumen Ejecutivo', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('gray').text(result.generatedAt.toLocaleString('es-ES'), { align: 'center' });
  doc.fillColor('black');
  doc.moveDown(1);

  doc.fontSize(13).text('1. Resumen Ejecutivo');
  doc.moveDown(0.3);
  doc.fontSize(10).text(result.summary, { align: 'left' });
  doc.moveDown(1);

  doc.fontSize(13).text('2. Metricas del Portafolio');
  doc.moveDown(0.3);
  doc.fontSize(10);
  doc.text(`   - OK:       ${stats.ok} campanas`);
  doc.text(`   - Warning:  ${stats.warning} campanas`);
  doc.text(`   - Critical: ${stats.critical} campanas`);
  doc.text(`   - Total:    ${stats.total} campanas`);
  doc.text(`   - Promedio: ${stats.avgMetric.toFixed(4)}`);
  doc.moveDown(1);

  if (result.criticalCampaigns.length > 0) {
    doc.fontSize(13).text('3. Campanas Criticas');
    doc.moveDown(0.3);
    doc.fontSize(10);
    result.criticalCampaigns.forEach((c, i) => {
      if (doc.y > 720) { doc.addPage(); }
      doc.text(`   ${i + 1}. ${c.name}`);
      doc.text(`      Metrica: ${c.metric.toFixed(4)}`);
      doc.text(`      Accion: ${c.action}`);
      doc.moveDown(0.3);
    });
    doc.moveDown(1);
  }

  if (result.recommendedActions.length > 0) {
    doc.fontSize(13).text('4. Acciones Recomendadas');
    doc.moveDown(0.3);
    doc.fontSize(10);
    result.recommendedActions.forEach((a, i) => {
      if (doc.y > 720) { doc.addPage(); }
      doc.text(`   ${i + 1}. ${a}`);
      doc.moveDown(0.2);
    });
    doc.moveDown(1);
  }

  doc.fontSize(13).text('5. Detalle de Campanas');
  doc.moveDown(0.3);

  doc.fontSize(9);
  reports.forEach((r) => {
    if (doc.y > 720) { doc.addPage(); }
    const label = r.status === 'critical' ? 'CRIT' : r.status === 'warning' ? 'WARN' : 'OK  ';
    doc.text(`   [${label}] ${r.metric.toFixed(4).padStart(7)} - ${r.name}`);
  });

  doc.moveDown(1);
  doc.fontSize(8).fillColor('gray').text(`Modelo: ${result.model}`, { align: 'center' });

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

    sendSummaryToDiscord(result, pdfPath);
  });
}
