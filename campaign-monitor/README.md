# Campaign Monitor

Sistema de monitoreo de campañas publicitarias con notificaciones automáticas y resúmenes ejecutivos generados por IA.

## Stack

- **TypeScript + Node.js** — Núcleo del sistema
- **SQLite** — Persistencia local de reportes
- **N8N** — Automatización de notificaciones (Slack/Discord, Google Sheets)
- **LLM (OpenRouter)** — Generación de resúmenes ejecutivos
- **BullMQ + Redis** — Jobs recurrentes (diferencial)

## Justificaciones técnicas

### ¿Por qué CoinGecko como API?

CoinGecko es una API pública que no requiere API key para el endpoint `/coins/markets`. Sus datos numéricos (% de cambio de precio en 24h) simulan métricas de campañas publicitarias de forma natural:

- Valores positivos → campaña rendimiento alto (ok)
- Valores cercanos a 0 → rendimiento bajo (warning)
- Valores muy negativos → campaña en crisis (critical)

### ¿Por qué esos umbrales?

| Umbral | Valor | Significado |
|--------|-------|-------------|
| Warning | < 2.5 | Atención requerida |
| Critical | < 1.0 | Acción inmediata |

La fórmula de normalización es: `rawMetric = price_change_24h + 5`

Esto centra los valores alrededor de 5, permitiendo que la mayoría de monedas estén en estado `ok` durante mercados estables, y que caigan a `warning` o `critical` durante caídas fuertes.

## Estructura del proyecto

```
campaign-monitor/
├── src/
│   ├── providers/       # Fuentes de datos (extensible)
│   │   ├── types.ts     # Interfaces DataProvider, RawCampaignData
│   │   └── coinGeckoProvider.ts
│   ├── evaluation/      # Lógica de umbrales
│   │   ├── types.ts     # CampaignReport, CampaignStatus
│   │   └── thresholds.ts
│   ├── utils/           # Utilidades
│   │   └── retry.ts     # Retry con backoff exponencial
│   ├── db/              # Persistencia
│   │   └── sqlite.ts
│   ├── llm/             # Generación de resúmenes (Fase 4)
│   ├── n8n/             # Webhook N8N
│   ├── review/          # Code review (Fase 3)
│   ├── jobs/            # BullMQ worker (Fase 5)
│   └── index.ts         # Entry point
├── prisma/              # Schema y queries (Fase 3)
├── n8n/                 # Flujo exportado (Fase 3)
└── data/                # Generado en runtime (gitignored)
```

## Instalación

```bash
cd campaign-monitor
npm install
cp .env.example .env
```

## Uso

```bash
# Ejecutar evaluación completa
npm run evaluate

# Inicializar base de datos
npm run db:init

# Generar resumen con LLM (requiere API key)
npm run summary
```

## Variables de entorno

Ver `.env.example` para todas las opciones. Las mínimas requeridas:

```env
COINGECKO_API_URL=https://api.coingecko.com/api/v3
COINGECKO_TOP_N=10
THRESHOLD_WARNING=2.5
THRESHOLD_CRITICAL=1.0
```
