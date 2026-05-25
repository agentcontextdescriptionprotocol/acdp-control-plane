# ACDP Control Plane — API Reference

Base URL: `http://localhost:3001` (dev). All non-public routes require
`Authorization: Bearer <key>` where `<key>` is in `AUTH_API_KEYS`. When
`AUTH_API_KEYS` is empty (dev), auth is bypassed.

Swagger UI is served at `/docs` (development only).

---

## Ingest

### `POST /ingest/acdp` — receive a registry webhook

**Public** (no Bearer token). Authenticated via HMAC-SHA256.

**Headers**
| Header | Description |
|--------|-------------|
| `x-acdp-signature` | `sha256=<hex>` of HMAC-SHA256(body, WEBHOOK_SECRET). Skipped when WEBHOOK_SECRET is empty. |
| `x-run-id`         | Optional. Correlates this event into a run. Takes precedence over `payload.run_id`. |
| `Content-Type`     | `application/json` |

**Body** — see [INGEST.md](./INGEST.md) for the canonical event shape. Minimum
required fields: `type`, `agent_id`, `registry_authority`.

**Responses**
| Status | Meaning |
|--------|---------|
| `204`  | Accepted, event persisted and broadcast. |
| `400`  | Malformed JSON / missing required fields. |
| `401`  | Bad or missing HMAC signature. |

### `GET /ingest/health` — liveness for registry config tests

**Public**. Returns `{ ok: true }`.

---

## Runs

| Method | Path                              | Description |
|--------|-----------------------------------|-------------|
| `GET`  | `/runs`                           | List runs with optional filters and pagination. |
| `GET`  | `/runs/:runId`                    | Fetch a single run. `404` if not found. |
| `GET`  | `/runs/:runId/lineage`            | Lineage DAG: `{ runId, nodes[], edges[] }`. |
| `GET`  | `/runs/:runId/events`             | Context events for the run, ordered by `event_ts`. |
| `GET`  | `/runs/:runId/events/stream`      | **SSE** — live events for this run (`text/event-stream`). |
| `POST` | `/runs/:runId/complete`           | Mark the run terminal. Body: `{ status, result? }`. Returns `204`. |

### `GET /runs` query parameters

| Param         | Type    | Notes |
|---------------|---------|-------|
| `status`      | enum    | `running` \| `completed` \| `failed` \| `cancelled` |
| `scenarioId`  | string  | Filter by `scenario_id` |
| `limit`       | int     | 1–200, default 50 |
| `offset`      | int     | ≥ 0, default 0 |

Response:
```json
{
  "data":  [ /* Run */ ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### `GET /runs/:runId/lineage` response

```json
{
  "runId": "run-001",
  "nodes": [
    {
      "ctxId": "acdp://registry-a/ctx-001",
      "agentId": "did:web:agent-a.example",
      "contextType": "task",
      "visibility": "public",
      "registryAuthority": "registry-a.example",
      "step": 1
    }
  ],
  "edges": [
    { "from": "acdp://registry-a/ctx-001", "to": "acdp://registry-a/ctx-002" }
  ]
}
```

### SSE: `GET /runs/:runId/events/stream`

Each event is emitted as `event: <event_type>\ndata: <json>\n\n`. A `heartbeat`
frame is emitted every `STREAM_SSE_HEARTBEAT_MS` (default 15 s).

Example:
```
event: context_published
data: {"type":"context_published","ts":"...","runId":"r-1",...}

event: heartbeat
data: {"ts":"2026-05-24T12:00:00Z"}
```

---

## Events (cross-run)

| Method | Path             | Description |
|--------|------------------|-------------|
| `GET`  | `/events`        | Cross-run event history with filters. |
| `GET`  | `/events/stream` | **SSE** — global firehose of all events. |

`GET /events` query parameters: `runId`, `eventType`, `agentId`,
`registryAuthority`, `afterTs` (ISO), `beforeTs` (ISO), `limit` (default 500).

---

## Contexts (federation proxy)

### `GET /contexts/:ctxId(.*)`

Proxies the request to the registry that owns the context. `ctx_id` format:
`acdp://<authority>/<uuid>`. The authority is extracted, looked up in the
`registries` table, and the request is forwarded to
`<base_url>/contexts/:ctxId`. `404` if the authority is unknown or unreachable.

---

## Agents / Registries

| Method | Path             | Description |
|--------|------------------|-------------|
| `GET`  | `/agents`        | List known agents (last 200, ordered by `last_seen`). |
| `GET`  | `/agents/:did(.*)` | Agent detail by DID. `404` if not seen. |
| `GET`  | `/registries`    | Known registries with event counts. |

---

## Dashboard

### `GET /dashboard/overview?window=1h|6h|24h|7d|30d`

KPIs over the window (default `24h`):

```json
{
  "window": "24h",
  "totalRuns":     12,
  "totalContexts": 87,
  "totalAgents":   5,
  "recentRuns":    [ /* last 10 runs */ ],
  "byScenario":    [ { "scenario_id": "...", "run_count": 4 } ],
  "byRegistry":    [ { "registry_authority": "...", "event_count": 31 } ]
}
```

---

## Webhooks (outbound subscriptions)

| Method   | Path             | Description |
|----------|------------------|-------------|
| `POST`   | `/webhooks`      | Create. Body: `{ url, events?, secret }`. |
| `GET`    | `/webhooks`      | List. |
| `PATCH`  | `/webhooks/:id`  | Update any of `{ url, events, secret, active }`. |
| `DELETE` | `/webhooks/:id`  | Remove. Returns `204`. |

When the control plane ingests an event, every active webhook whose `events`
list is empty (= all events) or contains the event type is dispatched. Body is
HMAC-SHA256 signed with the subscription's `secret`; signature is in
`X-ACDP-Signature: sha256=<hex>`, event type in `X-ACDP-Event`.

---

## Observability

| Method | Path        | Description |
|--------|-------------|-------------|
| `GET`  | `/healthz`  | Liveness probe (`{ ok, service }`). Pings DB. **Public.** |
| `GET`  | `/readyz`   | Readiness probe (`{ ok, database }`). **Public.** |
| `GET`  | `/metrics`  | Prometheus text-format metrics. **Public.** |
| `GET`  | `/docs`     | Swagger UI (dev only). |

Key metrics exposed:
- `http_request_duration_seconds` (histogram, labels: method/path/status_code)
- `http_requests_total` (counter, same labels)
- `active_sse_connections` (gauge)
- `acdp_events_ingested_total{event_type}` (counter)
- `acdp_webhook_deliveries_total{status}` (counter)
- plus Node.js default metrics (process_cpu, gc, memory, etc).

---

## Error responses

All non-`2xx` responses use the shape:

```json
{ "statusCode": 404, "errorCode": "RUN_NOT_FOUND", "message": "run X not found" }
```

`errorCode` is one of (`src/errors/error-codes.ts`):
`RUN_NOT_FOUND`, `REGISTRY_NOT_FOUND`, `AGENT_NOT_FOUND`, `CONTEXT_NOT_FOUND`,
`INVALID_PAYLOAD`, `INVALID_SIGNATURE`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.
