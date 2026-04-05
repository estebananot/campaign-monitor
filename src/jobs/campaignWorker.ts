import { Queue, Worker, Job } from 'bullmq';
import dotenv from 'dotenv';
import { CoinGeckoProvider } from '../providers/coinGeckoProvider';
import { buildReports } from '../evaluation/thresholds';
import { initDb, saveReports } from '../db/sqlite';
import { sendToN8N } from '../n8n/webhook';
import { generateCampaignSummary } from '../llm/generateSummary';

dotenv.config();

const QUEUE_NAME = 'campaign-evaluator';
const INTERVAL_MS = parseInt(process.env.JOB_INTERVAL_MINUTES ?? '5', 10) * 60 * 1000;
const connection = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

async function runPipeline(_job: Job): Promise<void> {
  console.log(`\n[BullMQ] Ejecutando pipeline — ${new Date().toISOString()}`);
  const provider = new CoinGeckoProvider();
  const rawData = await provider.fetchAll();
  const reports = buildReports(rawData);
  saveReports(reports);
  await sendToN8N(reports);
  const summary = await generateCampaignSummary(reports);
  console.log('[BullMQ] Resumen:', summary.summary);
}

async function startWorker(): Promise<void> {
  initDb();
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.add('evaluate', {}, { repeat: { every: INTERVAL_MS }, removeOnComplete: 10 });
  console.log(`[BullMQ] Worker iniciado. Job cada ${INTERVAL_MS / 60000} minutos.`);

  const worker = new Worker(QUEUE_NAME, runPipeline, { connection });
  worker.on('completed', () => console.log('[BullMQ] Job completado'));
  worker.on('failed', (_, err) => console.error('[BullMQ] Job fallido:', err.message));

  process.on('SIGTERM', async () => { await worker.close(); await queue.close(); process.exit(0); });
}

startWorker().catch((err) => { console.error('[BullMQ] Error fatal:', err); process.exit(1); });
