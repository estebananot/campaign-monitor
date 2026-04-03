import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { CoinGeckoProvider } from './providers/coinGeckoProvider';
import { buildReports } from './evaluation/thresholds';
import { initDb, saveReports } from './db/sqlite';
import { sendToN8N } from './n8n/webhook';

dotenv.config();

async function main(): Promise<void> {
  console.log('=== Campaign Monitor — iniciando evaluación ===\n');

  initDb();

  const provider = new CoinGeckoProvider();
  console.log(`[Provider] Usando: ${provider.name}`);
  const rawData = await provider.fetchAll();
  console.log(`[Provider] ${rawData.length} registros recibidos`);

  const reports = buildReports(rawData);

  const counts = {
    total: reports.length,
    ok: reports.filter(r => r.status === 'ok').length,
    warning: reports.filter(r => r.status === 'warning').length,
    critical: reports.filter(r => r.status === 'critical').length,
  };
  console.log('\n[Evaluación]', counts);

  saveReports(reports);

  const outputPath = path.join(process.cwd(), 'data', 'last-report.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(reports, null, 2));
  console.log('[File] Reporte guardado en data/last-report.json');

  await sendToN8N(reports);

  console.log('\n=== Evaluación completada ===');
}

main().catch((err) => {
  console.error('[ERROR FATAL]', err);
  process.exit(1);
});
