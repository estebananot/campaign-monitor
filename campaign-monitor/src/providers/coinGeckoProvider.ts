import axios from 'axios';
import dotenv from 'dotenv';
import { withRetry } from '../utils/retry';
import { DataProvider, RawCampaignData } from './types';

dotenv.config();

interface CoinGeckoItem {
  id: string;
  name: string;
  price_change_percentage_24h: number | null;
}

export class CoinGeckoProvider implements DataProvider {
  readonly name = 'CoinGecko';
  private readonly baseUrl: string;
  private readonly topN: number;

  constructor() {
    this.baseUrl = process.env.COINGECKO_API_URL ?? 'https://api.coingecko.com/api/v3';
    this.topN = parseInt(process.env.COINGECKO_TOP_N ?? '10', 10);
  }

  async fetchAll(): Promise<RawCampaignData[]> {
    const response = await withRetry(() =>
      axios.get<CoinGeckoItem[]>(`${this.baseUrl}/coins/markets`, {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: this.topN,
          page: 1,
          sparkline: false,
        },
        timeout: 8000,
      })
    );

    if (!Array.isArray(response.data)) {
      throw new Error(`[CoinGecko] Respuesta inesperada: ${typeof response.data}`);
    }

    return response.data.map((coin) => ({
      id: coin.id,
      name: coin.name,
      rawMetric: Math.max(0, (coin.price_change_percentage_24h ?? 0) + 5),
    }));
  }
}
