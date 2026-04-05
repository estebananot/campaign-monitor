# Diseño del agente de IA — Campaign Monitor

## Arquitectura general

El agente es un loop de razonamiento donde un LLM actúa como orquestador.
En cada ciclo consulta métricas, razona sobre ellas y ejecuta acciones concretas
a través de herramientas (tool-calling). Ninguna acción se ejecuta sin pasar por
el LLM: el agente razona antes de actuar y registra su justificación.

## Componentes

- **LLM orquestador**: recibe el estado de las campañas y decide qué tool invocar
- **Tool `query_campaigns`**: consulta la DB, retorna campañas por status
- **Tool `pause_campaign`**: llama a la API de la plataforma de ads para pausar
- **Tool `send_alert`**: envía mensaje al canal de Slack/Discord del equipo
- **Tool `log_action`**: escribe en `audit_log` antes de ejecutar cualquier acción
- **audit_log**: tabla que registra agentId, action, justification, timestamp, outcome

## Flujo de decisión (ReAct loop)

```
1. Observe  -> query_campaigns(status='critical')
2. Think    -> "Campaña X tiene ROAS 0.4 hace 3 ciclos. Umbral superado."
3. Act      -> log_action(action='pause', justification='ROAS < 0.5 por 3 ciclos')
              pause_campaign(id='X')
              send_alert(msg='Campaña X pausada. ROAS: 0.4')
4. Observe  -> confirmar que la pausa fue exitosa
5. Repeat o Stop
```

## Criterio de actuación

El agente actúa solo si la métrica supera el umbral por N ciclos consecutivos,
no por un spike puntual. Esto evita pausas accidentales por ruido en los datos.

## Auditabilidad

Toda acción escribe en `audit_log` antes de ejecutarse. Si falla, queda marcada
como `outcome: 'failed'`. Esto permite reconstruir exactamente qué hizo el
agente, cuándo, y cuál fue el razonamiento del modelo.

```
audit_log {
  id            CUID
  agentRunId    string
  action        'pause_campaign' | 'send_alert' | 'escalate'
  targetId      string
  justification text     ← razonamiento literal del LLM
  timestamp     DateTime
  outcome       'success' | 'failed' | 'skipped'
}
```

## Diferencia con un script automatizado

Un script evalúa condiciones fijas y ejecuta acciones determinísticas.
El agente evalúa contexto, razona en lenguaje natural y puede manejar
casos edge: "la campaña tiene ROAS bajo pero está en período de ramp-up,
esperar un ciclo más". Eso no es programable con if/else.

## Diagrama ASCII

```
┌───────────────────────────────────────────────────┐
│                   Agente IA                       │
│                                                   │
│    ┌──────────────────────────────────────────┐   │
│    │           LLM (orquestador)              │   │
│    │  recibe métricas → razona → elige tool   │   │
│    └────────────────────┬─────────────────────┘   │
│                         │ tool-call               │
│             ┌───────────▼─────────────┐           │
│             │         Tools           │           │
│             │  query_campaigns        │           │
│             │  pause_campaign         │           │
│             │  send_alert             │           │
│             │  log_action ← siempre   │           │
│             └───────────┬─────────────┘           │
│                         │ resultado               │
│    ┌────────────────────▼─────────────────────┐   │
│    │  ¿objetivo cumplido? → stop : continue   │   │
│    └──────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
                          │
                          ▼ 
                toda acción escribe en:
      audit_log { action, justification, timestamp }
```
