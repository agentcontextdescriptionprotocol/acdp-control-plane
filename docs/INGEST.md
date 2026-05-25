# Ingest Contract

This document describes what an ACDP **registry** must send to
`POST /ingest/acdp` for the control plane to ingest, correlate, and broadcast
events.

## Authentication — HMAC-SHA256

Every request must include an `x-acdp-signature` header whose value is the
hex-encoded HMAC-SHA256 of the **raw request body**, keyed with the
control plane's `WEBHOOK_SECRET`. The `sha256=` prefix is optional but
recommended.

```
x-acdp-signature: sha256=8d4f…9c3
```

The control plane uses a constant-time comparison (`timingSafeEqual`). Bodies
are read as raw bytes (`rawBody: true` on the Nest application) before JSON
parsing, so any byte difference — including whitespace — invalidates the
signature.

If `WEBHOOK_SECRET` is empty, HMAC verification is **skipped** (development
mode). The boot log emits a warning when this is the case in production.

### Reference signer (Node.js)

```ts
import { createHmac } from 'node:crypto';
import { request } from 'node:http';

const body = JSON.stringify(event);
const sig = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

await fetch('http://control-plane:3001/ingest/acdp', {
  method: 'POST',
  headers: {
    'Content-Type':     'application/json',
    'x-acdp-signature': `sha256=${sig}`,
    'x-run-id':         runId,             // optional but encouraged
  },
  body,
});
```

### Reference signer (Python)

```python
import hmac, hashlib, json, httpx

body = json.dumps(event, separators=(",", ":"))
sig  = hmac.new(WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()

httpx.post(
    "http://control-plane:3001/ingest/acdp",
    content=body,
    headers={
        "Content-Type":     "application/json",
        "x-acdp-signature": f"sha256={sig}",
        "x-run-id":         run_id,
    },
)
```

> Tip: serialize the body **once**, then sign and send that exact byte string.
> Re-serializing for the request will produce different bytes (e.g. key
> ordering, whitespace) and the signature will fail.

---

## Run correlation

Each event optionally carries a `run_id`. The control plane resolves it via:

1. The `x-run-id` HTTP header (preferred), or
2. The top-level `run_id` field in the JSON body.

The header wins when both are present. When neither is present, the event is
still persisted but is **not** attached to any run — it will show up in
`GET /events` but not in `GET /runs/:runId/events`.

A new run record is auto-created the first time the control plane sees a given
`run_id`. The `scenario_id` of the first event becomes the run's
`scenario_id`. Subsequent events with the same `run_id` increment
`contexts_count` and deduplicate `registries`.

---

## Event shape

The control plane is intentionally **liberal** in what it accepts — it stores
the raw payload in `context_events.raw_payload` and extracts a small set of
well-known fields:

| Field                | Required | Used for |
|----------------------|----------|----------|
| `type`               | **yes**  | Event type (e.g. `context_published`, `context_archived`). Lineage edges only fire on `context_published`. |
| `agent_id`           | **yes**  | DID of the emitting agent. Indexed; populates the `agents` table. |
| `registry_authority` | **yes**  | DNS-like identifier of the source registry. Indexed; populates the `registries` table. |
| `ctx_id`             | no       | `acdp://<authority>/<uuid>` URI of the context. |
| `lineage_id`         | no       | Free-form lineage identifier (separate from edge derivation). |
| `context_type`       | no       | Application-level type label. |
| `visibility`         | no       | `public` / `private` / etc. |
| `version`            | no       | Numeric version of the context. |
| `derived_from`       | no       | Array of `ctx_id`s. **Each entry becomes a lineage edge** when `type === 'context_published'`. |
| `scenario_id`        | no       | Falls back to `metadata.scenario_id` if absent. Defaults to `"unknown"` for the run record. |
| `run_id`             | no       | See "Run correlation" above. |
| `created_at`         | no       | ISO-8601 event timestamp. Defaults to the receive time at the control plane. |
| `metadata`           | no       | Free-form object. `metadata.scenario_id` is checked as a fallback. |

Unknown fields are preserved in `raw_payload` and surfaced via
`GET /runs/:runId/events`.

### Minimal example

```json
{
  "type":               "context_published",
  "agent_id":           "did:web:scoring-agent.example",
  "registry_authority": "registry-east.example",
  "ctx_id":             "acdp://registry-east.example/01F3…",
  "context_type":       "observation",
  "derived_from":       ["acdp://registry-east.example/01F2…"],
  "scenario_id":        "credit-review-v1",
  "created_at":         "2026-05-24T12:00:00Z"
}
```

---

## What happens after ingest

For each accepted event, the pipeline:

1. Persists the raw event into `context_events`.
2. Upserts the run (correlation), bumping `contexts_count` and the registry list.
3. Inserts a `lineage_edges` row per `derived_from` entry — only for
   `context_published` and idempotent (`ON CONFLICT DO NOTHING`).
4. Upserts the agent's row, bumping `context_count` and `last_seen`.
5. Upserts the registry's row, bumping `event_count` and `last_seen`.
6. Publishes a normalized `AcdpStreamEvent` to:
   - the per-run SSE feed at `/runs/:runId/events/stream`,
   - the global SSE feed at `/events/stream`.
7. Fires every matching outbound webhook (fire-and-forget; outbox-tracked).

The end-to-end response is `204 No Content` — the control plane does not echo
back the persisted event.

---

## Idempotency

The ingest endpoint does **not** dedupe events. If you POST the same payload
twice, you get two `context_events` rows. Lineage edges are deduplicated at the
DB level (unique on `(from_ctx_id, to_ctx_id)`), but raw events are not.

If a registry needs at-least-once delivery semantics, the control plane is
safe to call repeatedly — the only side effect of duplicate ingestion is a
slightly inflated `contexts_count` on the run and an inflated `event_count`
on the registry.
