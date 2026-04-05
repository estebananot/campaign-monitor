import dotenv from 'dotenv';
import { CampaignReport, CampaignStatus } from './types';
import { RawCampaignData } from '../providers/types';

dotenv.config();

const THRESHOLD_WARNING = parseFloat(process.env.THRESHOLD_WARNING ?? '2.5');
const THRESHOLD_CRITICAL = parseFloat(process.env.THRESHOLD_CRITICAL ?? '1.0');

function evaluateStatus(metric: number): CampaignStatus {
  if (metric < THRESHOLD_CRITICAL) return 'critical';
  if (metric < THRESHOLD_WARNING) return 'warning';
  return 'ok';
}

export function buildReports(rawData: RawCampaignData[]): CampaignReport[] {
  return rawData.map((item) => ({
    id: item.id,
    name: item.name,
    metric: parseFloat(item.rawMetric.toFixed(4)),
    status: evaluateStatus(item.rawMetric),
    evaluatedAt: new Date(),
  }));
}
