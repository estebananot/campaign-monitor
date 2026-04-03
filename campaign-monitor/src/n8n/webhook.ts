import axios from 'axios';
import dotenv from 'dotenv';
import { CampaignReport } from '../evaluation/types';

dotenv.config();

export async function sendToN8N(reports: CampaignReport[]): Promise<void> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn('[N8N] N8N_WEBHOOK_URL no configurado, omitiendo envío');
    return;
  }

  try {
    await axios.post(
      webhookUrl,
      { reports, generatedAt: new Date().toISOString() },
      { timeout: 5000 }
    );
    console.log('[N8N] Payload enviado al webhook');
  } catch (err) {
    console.error('[N8N] Error al enviar:', (err as Error).message);
  }
}
