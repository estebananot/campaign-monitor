import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { CampaignReport } from '../evaluation/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'campaigns.db');

function getDb(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return new Database(DB_PATH);
}

export function initDb(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_reports (
      id          TEXT NOT NULL,
      name        TEXT NOT NULL,
      metric      REAL NOT NULL,
      status      TEXT NOT NULL,
      evaluated_at TEXT NOT NULL
    );
  `);
  console.log('[DB] SQLite inicializado en', DB_PATH);
  db.close();
}

export function saveReports(reports: CampaignReport[]): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO campaign_reports (id, name, metric, status, evaluated_at)
    VALUES (@id, @name, @metric, @status, @evaluatedAt)
  `);

  const insertMany = db.transaction((items: CampaignReport[]) => {
    for (const item of items) {
      insert.run({
        id: item.id,
        name: item.name,
        metric: item.metric,
        status: item.status,
        evaluatedAt: item.evaluatedAt.toISOString(),
      });
    }
  });

  insertMany(reports);
  console.log(`[DB] ${reports.length} reportes guardados`);
  db.close();
}

if (process.argv.includes('--init')) {
  initDb();
}
