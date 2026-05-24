# Troubleshooting

## Ingest

### `401 Unauthorized` from `POST /ingest/acdp`

Possible causes:
- The `x-acdp-signature` header is missing.
- The signature is computed over a different body than what's on the wire (most
  often a re-serialized JSON with different key order or whitespace).
- The signature secret does not match `WEBHOOK_SECRET`.

Diagnostic checklist:
1. Confirm the registry signs the **exact** byte string it POSTs (sign once,
   send that buffer).
2. Confirm the secret is byte-identical on both sides (no trailing newlines).
3. Temporarily clear `WEBHOOK_SECRET` (dev only) to confirm the path works
   without HMAC.

### `400 Bad Request` from `POST /ingest/acdp`

Either the body isn't valid JSON, or one of the required fields is missing
(`type`, `agent_id`, `registry_authority`). See
[INGEST.md](./INGEST.md#event-shape).

### Events arrive but the run shows up as `scenario_id: "unknown"`

The first event for a new run sets the `scenario_id`. If neither the top-level
`scenario_id` nor `metadata.scenario_id` is present, the run is created with
`"unknown"`. Re-emitting the event after fixing the field won't backfill — the
run row is only set on first sight.

---

## SSE

### Subscribers don't receive events

1. Confirm the client sets `Accept: text/event-stream`. (Browsers using
   `EventSource` do this automatically.)
2. Confirm any intermediary (nginx, ALB) isn't buffering. For nginx, set
   `proxy_buffering off;` and `proxy_read_timeout` longer than your heartbeat.
3. Use `curl -N http://localhost:3001/events/stream` to bypass the client and
   confirm the server is emitting.

### Stream stalls after a minute of no activity

Increase `STREAM_SSE_HEARTBEAT_MS` if your proxy is more aggressive about idle
connections; the default is 15 s.

### `memory` strategy: subscribers on different replicas miss events

Expected. Switch to `STREAM_HUB_STRATEGY=redis` + `REDIS_URL` for multi-replica
deployments. The control plane warns at boot when it detects production +
memory strategy.

---

## Database

### `relation "..." does not exist`

Migrations didn't run at boot. Causes:
- `dist/` was built without copying the `drizzle/` directory.
- `DATABASE_URL` points at a different database than the one migrations were
  applied to.

Fix: run `npm run migrate` explicitly to apply pending migrations, then verify
with:
```sql
SELECT name FROM _migrations ORDER BY name;
```

### `pool error: too many clients`

The default `DB_POOL_MAX=20` per replica. With many replicas, your Postgres
`max_connections` may be exhausted. Either raise `max_connections` or shrink
`DB_POOL_MAX`. The config service refuses to start with `DB_POOL_MAX < 2` in
production.

---

## Webhooks

### Deliveries stuck on `status='pending'`

The worker performs three attempts with exponential backoff (1s, 2s, 4s).
After three failures the row flips to `failed`. The control plane does **not**
re-deliver automatically — you have to call `WebhookService.retryPending()`
yourself (e.g. wire up a cron or admin endpoint).

Inspect with:
```sql
SELECT id, webhook_id, event, status, attempts, error_message, last_attempt_at
FROM webhook_deliveries
ORDER BY created_at DESC
LIMIT 20;
```

### Subscriber receives the body but the signature doesn't verify

The control plane signs the **stringified JSON payload as sent**. If your
receiver parses and re-serializes before signing, the bytes differ. Compute the
expected HMAC over the raw HTTP request body before any framework
deserialization.

---

## Health probes

### `GET /readyz` returns `database: "unhealthy"` even though Postgres is up

The pool emitted a fatal error (`hasFatalError=true`). This sticks for the
lifetime of the process. Restart the pod. Look for prior pool errors in the
logs (`database pool error: …`).

---

## Local dev

### `npm run start:dev` exits with `Error: AUTH_API_KEYS must be set …`

`NODE_ENV=production` was inherited from the shell or `.env`. The fail-fast
validation runs whenever `NODE_ENV !== 'development'`. Either set
`NODE_ENV=development` or supply the missing variables (`AUTH_API_KEYS`,
`WEBHOOK_SECRET` etc).

### Integration tests fail with `ECONNREFUSED localhost:5433`

The test postgres container isn't running. `npm run test:integration` invokes
`docker compose -f docker-compose.test.yml up -d postgres-test` in
`globalSetup`; if Docker isn't running, start it manually:

```bash
docker compose -f docker-compose.test.yml up -d postgres-test
KEEP_TEST_DB=1 npm run test:integration
```

The `KEEP_TEST_DB=1` flag tells the teardown to leave the container running so
re-runs are fast.
