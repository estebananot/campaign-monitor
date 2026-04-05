export interface RawCampaignData {
  id: string;
  name: string;
  rawMetric: number;
}

export interface DataProvider {
  readonly name: string;
  fetchAll(): Promise<RawCampaignData[]>;
}
