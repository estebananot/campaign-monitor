import { CampaignReport } from '../evaluation/types';

export const SYSTEM_PROMPT = `Eres un analista senior de campañas publicitarias con 10 años de experiencia.
Tu trabajo es analizar métricas de campañas y generar resúmenes ejecutivos accionables para directivos.

Recibirás datos de campañas en JSON. Responde ÚNICAMENTE con un objeto JSON válido.
No incluyas texto fuera del JSON. No uses markdown ni bloques de código.

Estructura exacta requerida:
{
  "summary": "resumen ejecutivo detallado de 4-5 oraciones que incluya: estado general del portafolio, tendencias identificadas, campañas destacadas positiva y negativamente, y contexto del mercado",
  "criticalCampaigns": [
    { "id": "string", "name": "string", "metric": 0.0, "action": "acción específica y concreta con justificación" }
  ],
  "warningCount": 0,
  "warningDetails": [
    { "name": "string", "metric": 0.0, "note": "observación sobre esta campaña" }
  ],
  "recommendedActions": ["acción 1 con contexto", "acción 2 con prioridad"],
  "kpis": {
    "bestCampaign": "nombre de la mejor campaña",
    "worstCampaign": "nombre de la peor campaña",
    "avgMetric": 0.0,
    "riskLevel": "bajo|medio|alto"
  }
}

Reglas importantes:
1. El summary debe ser DETALLADO y PROFESIONAL, como un reporte ejecutivo real
2. Menciona TODAS las campañas critical por nombre con acciones específicas
3. Si no hay críticas, explica por qué el portafolio está estable
4. Las acciones deben incluir el "por qué" además del "qué"
5. Incluye KPIs clave: mejor/peor campaña, promedio, nivel de riesgo
6. Responde SIEMPRE en español profesional`;

export function buildUserPrompt(reports: CampaignReport[]): string {
  const stats = {
    total: reports.length,
    ok: reports.filter(r => r.status === 'ok').length,
    warning: reports.filter(r => r.status === 'warning').length,
    critical: reports.filter(r => r.status === 'critical').length,
    avgMetric: reports.reduce((sum, r) => sum + r.metric, 0) / reports.length,
    bestCampaign: reports.reduce((best, r) => r.metric > best.metric ? r : best, reports[0]),
    worstCampaign: reports.reduce((worst, r) => r.metric < worst.metric ? r : worst, reports[0]),
  };

  return `Analiza estas campañas publicitarias y genera un resumen ejecutivo detallado.

ESTADÍSTICAS DEL PORTAFOLIO:
- Total campañas: ${stats.total}
- Estado OK: ${stats.ok}
- Estado Warning: ${stats.warning}
- Estado Critical: ${stats.critical}
- Métrica promedio: ${stats.avgMetric.toFixed(4)}
- Mejor campaña: ${stats.bestCampaign.name} (${stats.bestCampaign.metric})
- Peor campaña: ${stats.worstCampaign.name} (${stats.worstCampaign.metric})

DATOS DETALLADOS:
${JSON.stringify(reports, null, 2)}

Genera un análisis completo como si fuera para el CEO de la empresa.`;
}
