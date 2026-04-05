export type CampaignStatus = 'ok' | 'warning' | 'critical';

export interface CampaignReport {
  id: string;
  name: string;
  metric: number;
  status: CampaignStatus;
  evaluatedAt: Date;
}
