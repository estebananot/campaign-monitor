import axios from 'axios';

async function fetchCampaignData(campaignId: string) {
  const response = await axios.get(`https://api.example.com/campaigns/${campaignId}`);
  const data = response.data;
  return {
    id: data.id,
    clicks: data.clicks,
    impressions: data.impressions,
    ctr: data.clicks / data.impressions  // BUG 1: división por cero
  };                                       // BUG 2: sin try/catch
}

async function processCampaigns(ids: string[]) {
  const results = [];                      // BUG 3: tipo implícito any[]
  for (const id of ids) {
    const campaign = await fetchCampaignData(id); // BUG 4: loop secuencial
    results.push(campaign);
  }
  return results;
}
