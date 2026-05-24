# Testing

Two layers, two commands.

## Unit tests

Colocated next to source as `*.spec.ts`. Jest discovers them via the
configuration block in `package.json` (`rootDir: src`, `testRegex:
.*\.spec\.ts$`). Dependencies are mocked; no DB, no HTTP server, no network.

```bash
npm test                 # one-shot
npm run test:watch       # watch mode
npm run test:cov         # with coverage report → coverage/
```

What's covered (the contracts most likely to break under a refactor):

| File                                    | What it pins down                                                  |
|-----------------------------------------|--------------------------------------------------------------------|
| `src/ingest/hmac.spec.ts`               | HMAC verifier: prefix tolerance, tampering, empty-secret bypass    |
| `src/ingest/ingest.service.spec.ts`     | HMAC + JSON parsing + required-field validation + run-id precedence |
| `src/processor/event-processor.service.spec.ts` | The 6-step pipeline (persist→correlate→lineage→agent/registry→SSE→webhooks) |
| `src/auth/auth.guard.spec.ts`           | Bearer/raw key handling, `@Public()`, dev-mode bypass              |
| `src/errors/exception.filter.spec.ts`   | `AppException` rendering, message non-leakage on unknown errors    |
| `src/webhooks/webhook.service.spec.ts`  | Event filtering, HMAC headers, outbox tracking, error swallowing   |
| `src/runs/runs.service.spec.ts`         | Pagination wrapping, playground notification (fire-and-forget)     |
| `src/config/app-config.service.spec.ts` | Env-var parsing + production fail-fast validation                  |
| `src/events/memory-stream-hub.strategy.spec.ts` | Per-run isolation, global feed, destroy semantics             |

## Integration tests

Live in `test/integration/`. Boot the full NestJS app, run real migrations
against a real Postgres (port `5433` by default), exercise via HTTP. Run
serially (`maxWorkers: 1`) and truncate all tables between specs (via
`ctx.cleanup()` in `beforeEach`).

```bash
npm run test:integration
```

By default `globalSetup` starts Postgres via Docker Compose
(`docker-compose.test.yml`). If you're managing the container yourself, set
`KEEP_TEST_DB=1` to skip teardown:

```bash
docker compose -f docker-compose.test.yml up -d postgres-test
KEEP_TEST_DB=1 npm run test:integration
```

In CI, set `CI=1` to skip the docker-compose orchestration entirely and rely on
service containers.

### Suites

| Spec                                          | Covers                                                                         |
|-----------------------------------------------|--------------------------------------------------------------------------------|
| `health.integration.spec.ts`                  | `/healthz`, `/readyz`, `/metrics` shape + public access                       |
| `auth.integration.spec.ts`                    | Missing / wrong / valid Bearer; `@Public()` bypass                            |
| `ingest.integration.spec.ts`                  | HMAC verify, payload validation, run correlation across multiple events       |
| `lineage.integration.spec.ts`                 | DAG construction, edge dedup, empty-DAG path                                  |
| `runs-lifecycle.integration.spec.ts`          | `running` → `completed` lifecycle, list filters + pagination, 404s            |
| `events-stream.integration.spec.ts`           | Per-run SSE isolation, global SSE firehose                                    |
| `webhooks.integration.spec.ts`                | Create/list/delete + 400 validation                                           |

### How the test app is wired (`test/helpers/test-app.ts`)

- Clears the `prom-client` registry to avoid duplicate-metric errors between
  suites that re-instantiate `InstrumentationService`.
- Runs `runMigrations(TEST_DB_URL)` against the test database before booting.
- Boots the real `AppModule` with `rawBody: true`, the global `ValidationPipe`,
  and `GlobalExceptionFilter` — the same wiring as `main.ts` minus helmet and
  swagger.
- Listens on a random port (`app.listen(0)`); tests reach it via `ctx.url` or
  the typed `TestClient`.
- Exposes `ctx.cleanup()` which truncates all tables — call it in `beforeEach`.

### How to write a new integration spec

```ts
import { createTestApp, TestAppContext } from '../helpers/test-app';

describe('my feature', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp({ webhookSecret: 'optional-secret' });
  });

  beforeEach(async () => {
    await ctx.cleanup();        // truncate between tests
  });

  afterAll(async () => {
    await ctx.app.close();      // closes pool, completes SSE subjects
  });

  it('does the thing', async () => {
    const res = await ctx.client.ingest(myEvent, { runId: 'r-1', secret: 'optional-secret' });
    expect(res.status).toBe(204);
  });
});
```

For SSE:
```ts
import { TestSSEClient } from '../helpers/sse-client';

const sse = new TestSSEClient(ctx.url, 'test-key');
await sse.connect(`/runs/${runId}/events/stream`);
await sse.waitForEvent('context_published', 5000);
sse.close();
```
