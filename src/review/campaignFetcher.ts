import axios from 'axios';
import pLimit from 'p-limit';

interface CampaignResult {
  id: string;
  clicks: number;
  impressions: number;
  ctr: number;
}

async function fetchCampaignData(campaignId: string): Promise<CampaignResult | null> {
  try {
    const response = await axios.get<{
      id: string;
      clicks: number;
      impressions: number;
    }>(`https://api.example.com/campaigns/${campaignId}`, { timeout: 5000 });

    const { id, clicks, impressions } = response.data;

    return {
      id,
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
    };
  } catch (err) {
    console.error(`[fetchCampaignData] Error en ${campaignId}:`, (err as Error).message);
    return null;
  }
}

async function processCampaigns(ids: string[]): Promise<CampaignResult[]> {
  const limit = pLimit(3);

  const results = await Promise.all(
    ids.map(id => limit(() => fetchCampaignData(id)))
  );

  return results.filter((r): r is CampaignResult => r !== null);
}

function getLowCTRCampaigns(results: CampaignResult[]): CampaignResult[] {
  return results
    .filter(c => c.ctr < 0.02)
    .sort((a, b) => a.ctr - b.ctr);
}

export { fetchCampaignData, processCampaigns, getLowCTRCampaigns, CampaignResult };

if (process.argv.includes('--test')) {
  const mock: CampaignResult[] = [
    { id: '1', clicks: 5,  impressions: 1000, ctr: 0.005 },
    { id: '2', clicks: 30, impressions: 1000, ctr: 0.030 },
    { id: '3', clicks: 0,  impressions: 0,    ctr: 0     },
    { id: '4', clicks: 10, impressions: 1000, ctr: 0.010 },
  ];
  console.log('CTR < 0.02 ordenadas:', getLowCTRCampaigns(mock));
}
