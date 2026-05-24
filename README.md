# ACDP Control Plane

Scenario-agnostic control plane for the Agent Context Description Protocol
(ACDP). Ingests webhook events from ACDP registries, correlates them into runs
via the `X-Run-Id` header, persists raw events + lineage edges, and broadcasts
the firehose via Server-Sent Events.

## Architecture

```
              ┌──────────────────────────────────────────┐
              │              ACDP Registry               │
              └────────────────────┬─────────────────────┘
                                   │ POST /ingest/acdp (HMAC)
                                   ▼
   ┌───────────────────────────────────────────────────────┐
   │                  ACDP Control Plane                   │
   │                                                       │
   │  IngestController → IngestService (HMAC verify)       │
   │       │                                               │
   │       ▼                                               │
   │  EventProcessorService                                │
   │     ├─ persist raw event                              │
   │     ├─ upsert run (X-Run-Id)                          │
   │     ├─ insert lineage edges                           │
   │     ├─ upsert agent + registry                        │
   │     ├─ publish per-run + global SSE                   │
   │     └─ fire outbound webhooks                         │
   │                                                       │
   │  /runs, /events, /dashboard, /contexts (federation)   │
   │  /healthz /readyz /metrics /docs                      │
   └───────────────────────────────────────────────────────┘
```

## Quick start

```bash
docker compose up -d postgres
npm install
cp .env.example .env
npm run start:dev
# → http://localhost:3001/docs
```

## Testing

```bash
npm test                       # unit tests (mocked deps, no DB)
npm run test:integration       # boots app + real Postgres on :5433
```

See [docs/TESTING.md](docs/TESTING.md) for the test harness, helpers, and how to
add a new spec.

## Documentation

| Doc | What's in it |
|-----|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)   | System context, module layout, the 6-step pipeline, SSE strategies, webhook outbox |
| [docs/API.md](docs/API.md)                     | Full route reference with request/response shapes |
| [docs/INGEST.md](docs/INGEST.md)               | The webhook contract: HMAC signing, run correlation, event shape, idempotency |
| [docs/TESTING.md](docs/TESTING.md)             | Unit + integration test layout and how to write a new spec |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common errors and how to diagnose them |
| `CLAUDE.md`                                    | Project conventions for agents working in this repo |
