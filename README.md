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

Los umbrales son los definidos en la prueba técnica:

| Umbral | Valor | Significado |
|--------|-------|-------------|
| Warning | < 2.5 | Atención requerida |
| Critical | < 1.0 | Acción inmediata |

### Fórmula de normalización

```
rawMetric = price_change_percentage_24h + 5
```

**¿Por qué +5?**

CoinGecko devuelve el cambio de precio en porcentaje (ej: -3.5%, +2.1%). Al sumar +5:
- Valores típicos quedan entre 2 y 8 (rango de "métrica de campaña")
- Permite que caigan en los tres estados: ok (≥2.5), warning (<2.5), critical (<1.0)
- Simula el comportamiento real de métricas publicitarias donde algunos días son mejores que otros

**Nota sobre variabilidad:**

Los datos de CoinGecko dependen del mercado de criptomonedas en tiempo real. Si todos los valores están en `ok`, significa que el mercado está estable ese día. Para forzar variabilidad en pruebas, se puede:
1. Cambiar temporalmente los umbrales en `.env`
2. Usar una API mock que devuelva datos variados
3. Esperar a un día de volatilidad en el mercado

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
```

## Uso

### Flujo completo

```bash
# 1. Obtener datos de CoinGecko, evaluar umbrales, guardar en SQLite y JSON
npm run evaluate

# 2. Generar resumen con LLM, crear PDF y enviar a Discord
npm run summary
```

### Comandos individuales

```bash
# Evaluar campañas (API → evaluación → SQLite → JSON → N8N webhook)
npm run evaluate

# Generar resumen LLM + PDF + Discord
npm run summary

# Resumen estructurado (JSON)
npm run summary:structured

# Inicializar base de datos SQLite
npm run db:init

# Probar code review (filtra CTR < 0.02)
npm run test:review

# Ejecutar query de Prisma (peor ROAS por operador)
npm run prisma:query

# Ejecutar BullMQ worker (requiere Redis)
npm run worker
```

## Code Review (Parte 3A)

Se recibió un fragmento de código con 4 problemas identificados:

### Problemas encontrados

| Bug | Ubicación | Problema | Fix |
|-----|-----------|----------|-----|
| 1 | Línea 10 | División por cero: `clicks / impressions` | `impressions > 0 ? clicks / impressions : 0` |
| 2 | Línea 11 | Sin try/catch — un error rompe todo el batch | try/catch por campaña, error aislado |
| 3 | Línea 15 | Tipo implícito `any[]` en results | Interfaz `CampaignResult` explícita |
| 4 | Línea 17 | Loop secuencial — peticiones una por una | `pLimit(3)` — concurrencia controlada (máx 3 simultáneas) |

### Refactorización aplicada

La refactorización es **quirúrgica**: se corrigieron los bugs sin reescribir toda la función. Se mantuvo la estructura original pero se agregaron:
- Tipado explícito con interfaz `CampaignResult`
- Manejo de errores por campaña (error aislado no rompe el batch)
- Concurrencia controlada con `p-limit` (máximo 3 peticiones simultáneas)
- Función adicional `getLowCTRCampaigns()` para filtrar CTR < 0.02

## Query de Prisma (Parte 3B)

### Estructura del schema

```prisma
model Operator {
  id        String     @id @default(cuid())
  name      String
  campaigns Campaign[]
}

model Campaign {
  id         String           @id @default(cuid())
  name       String
  operatorId String
  operator   Operator         @relation(fields: [operatorId], references: [id])
  metrics    CampaignMetric[]
}

model CampaignMetric {
  id         String   @id @default(cuid())
  campaignId String
  campaign   Campaign @relation(fields: [campaignId], references: [id])
  roas       Float
  recordedAt DateTime
}
```

### Query implementada

La query retorna los operadores con **peor ROAS promedio de los últimos 7 días**, agrupados por operador y ordenados de menor a mayor ROAS.

**¿Por qué `findMany` con post-proceso?**

Prisma no soporta agrupar por campos de relaciones anidadas sin raw SQL. Se usa `findMany` con nested `select` para traer operadores → campañas → métricas (filtradas por fecha), y luego se calcula el promedio en TypeScript. Esto mantiene el tipado fuerte sin perder funcionalidad.

### Ejemplo de output

```
Operadores con peor ROAS promedio (últimos 7 días):

1. Beta Media           | Avg ROAS: 1.2623 | Campañas: 1
2. Acme Corp            | Avg ROAS: 1.7634 | Campañas: 1
3. Gamma Ads            | Avg ROAS: 1.828  | Campañas: 1
```

## Variables de entorno

```env
# API externa
COINGECKO_API_URL=https://api.coingecko.com/api/v3
COINGECKO_TOP_N=50

# Umbrales
THRESHOLD_WARNING=2.5
THRESHOLD_CRITICAL=1.0

# N8N Webhook
N8N_WEBHOOK_URL=http://localhost:5678/webhook/campaign-monitor

# Discord Webhook (para resumen LLM)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy

# LLM
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-tu-key
OPENROUTER_MODEL=openai/gpt-3.5-turbo

# Redis (para BullMQ)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JOB_INTERVAL_MINUTES=5
```

## BullMQ + Redis (Diferencial)

El worker de BullMQ ejecuta el pipeline automáticamente cada X minutos.

### Instalar Redis

```bash
# Docker (recomendado)
docker run -d -p 6379:6379 --name redis redis:alpine

# Windows (usar Memurai o WSL)
# macOS
brew install redis && brew services start redis

# Ubuntu/Debian
sudo apt install redis-server && sudo systemctl start redis
```

### Ejecutar worker

```bash
npm run worker
```

El worker ejecutará automáticamente:
- Consulta CoinGecko
- Evalúa umbrales
- Guarda en SQLite
- Envía a N8N
- Genera resumen LLM

Cada 5 minutos (configurable con `JOB_INTERVAL_MINUTES` en `.env`).
