# ACDP Control Plane — Architecture

## System Context

The ACDP Control Plane is a NestJS service that sits **downstream** of the ACDP
registries (which authoritatively store contexts and emit lifecycle webhooks) and
**upstream** of any UI / playground / observer. It:

1. **Ingests** webhook events from registries (HMAC-SHA256 authenticated).
2. **Correlates** events into *runs* via the `X-Run-Id` header.
3. **Persists** raw events, run records, and a lineage adjacency table.
4. **Broadcasts** the firehose via SSE — both per-run and global feeds.
5. **Proxies** federated context retrievals to the authoring registry.

```
              ┌──────────────────────┐
              │   ACDP Registry A    │──┐
              └──────────────────────┘  │  POST /ingest/acdp
              ┌──────────────────────┐  │  (HMAC-SHA256,
              │   ACDP Registry B    │──┼──  X-Run-Id header)
              └──────────────────────┘  │
                                        ▼
              ┌─────────────────────────────────────────────────┐
              │            ACDP Control Plane                   │
              │                                                 │
              │  IngestController ─► IngestService              │
              │       │ (HMAC verify, JSON parse)               │
              │       ▼                                         │
              │  EventProcessorService                          │
              │     ├─ persist raw (context_events)             │
              │     ├─ upsert run                               │
              │     ├─ insert lineage edges                     │
              │     ├─ upsert agent / registry                  │
              │     ├─ publish per-run + global SSE             │
              │     └─ fire outbound webhooks (outbox)          │
              │                                                 │
              │  /runs  /events  /dashboard  /contexts          │
              │  /healthz  /readyz  /metrics  /docs             │
              └─────────────────────────────────────────────────┘
                            │                    │
                            ▼                    ▼
                   ┌──────────────┐    ┌──────────────────┐
                   │ PostgreSQL   │    │ SSE consumers    │
                   │ (Drizzle ORM)│    │ UI / playground  │
                   └──────────────┘    └──────────────────┘
```

## Module layout

```
src/
├── main.ts                    # Bootstrap: pino logger, helmet, swagger, OTel, migrations
├── app.module.ts              # Wiring: ConfigModule, DatabaseModule, AuthModule, ThrottlerModule
│
├── config/                    # AppConfigService (single home for all process.env reads)
├── db/                        # Drizzle schema, Pool wrapper, programmatic migrate runner
├── auth/                      # AuthGuard (Bearer / raw API key), Public() decorator
├── middleware/                # Correlation-ID (AsyncLocalStorage), request logger
│
├── ingest/                    # POST /ingest/acdp + HMAC verify
├── processor/                 # EventProcessorService — the pipeline core
│
├── storage/                   # Repositories: context-event, run, lineage, agent, registry
├── webhooks/                  # Outbound webhook subs + outbox-tracked delivery
├── events/                    # StreamHub (memory + redis strategies), /events controller
├── runs/                      # /runs controller + service
├── contexts/                  # Federation proxy controller
├── agents/                    # /agents controller
├── registries/                # /registries controller
├── dashboard/                 # /dashboard/overview KPIs
├── health/                    # /healthz, /readyz
├── metrics/                   # /metrics (Prometheus)
│
├── contracts/                 # Wire types (AcdpWebhookEvent, AcdpStreamEvent, LineageDag)
├── errors/                    # AppException + ErrorCode + GlobalExceptionFilter
├── telemetry/                 # OTel SDK init + InstrumentationService
└── common/                    # PinoLogger
```

## The pipeline (`EventProcessorService.process`)

For every accepted event the processor performs **six** ordered steps:

| # | Step                       | Mutation                                                                       |
|---|----------------------------|--------------------------------------------------------------------------------|
| 1 | persist raw                | `INSERT INTO context_events` (the full payload is kept as `raw_payload`)        |
| 2 | run correlation            | `INSERT … ON CONFLICT` into `runs` — bumps `contexts_count`, dedupes registries |
| 3 | lineage edges              | one `INSERT … ON CONFLICT DO NOTHING` into `lineage_edges` per `derived_from`  |
| 4 | agent upsert               | `INSERT … ON CONFLICT (agent_did) DO UPDATE` — bumps `last_seen`, `context_count`|
| 5 | registry upsert            | same shape, on `registries`                                                    |
| 6 | broadcast + webhooks       | publish to per-run + global SSE; fire matching outbound webhooks (fire-and-forget) |

Lineage edges are only inserted when `type === 'context_published'` and there is
at least one `derived_from` entry. The DAG is therefore a property of
*published* contexts only.

## SSE strategies

| Strategy | When to use | Behavior |
|----------|-------------|----------|
| `memory` (default) | single instance | Per-run RxJS `Subject` map + one global `Subject`; per-run subjects GC'd 60s after the last subscriber disconnects |
| `redis`            | multi-instance HA | Wraps a Redis pub/sub channel; each instance re-emits inbound messages on local Subjects so any subscriber on any instance receives events |

Heartbeat frames (`event: heartbeat`) are emitted every `STREAM_SSE_HEARTBEAT_MS`
(default 15 s) to keep intermediaries from closing idle connections.

## Webhook outbox

Outbound webhooks are **outbox-tracked**: every `WebhookService.fireEvent` call
first persists a `webhook_deliveries` row with `status='pending'`, then attempts
delivery in a fire-and-forget task. On `2xx` the row flips to `delivered`; on
3-strike failure it flips to `failed`. `WebhookService.retryPending()` can be
called by an operator (or cron) to re-attempt the long tail. The delivery body is
signed with HMAC-SHA256 using the subscription's `secret` and sent in the
`X-ACDP-Signature: sha256=…` header.

## Auth model

`AuthGuard` (a global guard) requires an `Authorization: Bearer <key>` header
matching one of `AUTH_API_KEYS`. The ingest endpoint and observability probes
opt out via `@Public()`. The ingest endpoint authenticates **via HMAC**, not via
bearer token — registries do not carry an API key.

`ThrottleByUserGuard` rate-limits per actor (using `actorId` set by `AuthGuard`,
falling back to client IP).

## Operational concerns

- **Migrations** run programmatically at boot (`src/db/migrate.ts`). No
  `drizzle-kit` dependency at runtime; SQL files are committed under `drizzle/`.
- **Graceful shutdown** is wired via `enableShutdownHooks()`. `DatabaseService`
  drains its pool in `onModuleDestroy`; `StreamHubService` completes all
  Subjects.
- **Observability**: pino structured logs (`request-logger.middleware.ts` emits
  per-request JSON), Prometheus metrics on `/metrics`, optional OTel SDK
  (`OTEL_ENABLED=true`).
- **Sandbox**: when `WEBHOOK_SECRET` is empty, HMAC verification is **skipped**
  — useful for local dev, never use in production. The config service warns at
  boot.
