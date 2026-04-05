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
  recommendedActions: string[];
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

function generatePDF(result: LLMSummary, reports: CampaignReport[]): string {
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const pdfPath = path.join(dataDir, 'campaign-report.pdf');

  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  doc.fontSize(20).text('Campaign Monitor — Resumen Ejecutivo', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('gray').text(`Generado: ${result.generatedAt.toLocaleString()}`, { align: 'center' });
  doc.text(`Modelo: ${result.model}`);
  doc.moveDown();

  doc.fontSize(14).fillColor('black').text('Resumen');
  doc.fontSize(11).text(result.summary);
  doc.moveDown();

  if (result.criticalCampaigns.length > 0) {
    doc.fontSize(14).fillColor('red').text('Campañas Críticas');
    doc.moveDown(0.5);
    result.criticalCampaigns.forEach(c => {
      doc.fontSize(11).fillColor('black').text(`• ${c.name} (métrica: ${c.metric})`);
      doc.fontSize(10).fillColor('gray').text(`  Acción: ${c.action}`);
    });
    doc.moveDown();
  }

  if (result.warningCount > 0) {
    doc.fontSize(14).fillColor('orange').text(`Campañas en Warning: ${result.warningCount}`);
    doc.moveDown();
  }

  if (result.recommendedActions.length > 0) {
    doc.fontSize(14).fillColor('black').text('Acciones Recomendadas');
    doc.moveDown(0.5);
    result.recommendedActions.forEach(a => {
      doc.fontSize(11).text(`• ${a}`);
    });
    doc.moveDown();
  }

  doc.fontSize(14).text('Detalle de Campañas');
  doc.moveDown(0.5);
  doc.fontSize(9);
  reports.forEach(r => {
    const color = r.status === 'critical' ? 'red' : r.status === 'warning' ? 'orange' : 'green';
    doc.fillColor(color).text(`${r.status.toUpperCase().padEnd(8)} | ${r.metric.toFixed(4).padStart(6)} | ${r.name}`);
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
