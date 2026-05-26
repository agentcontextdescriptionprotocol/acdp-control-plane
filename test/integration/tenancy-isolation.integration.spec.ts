/**
 * Cross-tenant isolation integration test.
 *
 * Per deferred-plan §6: tenant-A's data MUST NOT be readable by a
 * request bearing tenant-B credentials. This spec writes events
 * under both tenants then exercises GET /runs from each side and
 * asserts the isolation.
 *
 * Coverage is intentionally narrow — proves the tenant gate works
 * end-to-end on at least one controller path. Per-controller
 * regressions would be caught by their own specs (most read paths
 * are filtered at the repository layer).
 */
import { createTestApp, TestAppContext } from '../helpers/test-app';
import { TestClient } from '../helpers/test-client';

describe('Cross-tenant isolation (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      tenantApiKeys: [
        { tenantId: 'tenant-a', apiKey: 'key-a' },
        { tenantId: 'tenant-b', apiKey: 'key-b' },
      ],
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.cleanup();
  });

  /**
   * Helper: send a registry webhook tagged with `X-Tenant-Id`. The
   * ingest endpoint is `@Public()` (authenticated by HMAC, not bearer)
   * so AuthGuard doesn't pin tenantId from a key — the upstream
   * registry sets the header to attribute the event to a tenant.
   */
  async function publishEvent(tenantId: string, runId: string) {
    // Auth header is irrelevant on @Public ingest, but TestClient
    // requires a key. Any non-empty key works since AUTH_API_KEYS
    // is populated (any of the tenant keys would pass).
    const client = new TestClient(ctx.url, 'key-a');
    const body = {
      type: 'context_published',
      run_id: runId,
      agent_id: 'did:web:agent.example',
      ctx_id: `acdp://r.local/${runId}`,
      lineage_id: 'lin:sha256:x',
      context_type: 'data_snapshot',
      visibility: 'public',
      version: 1,
      derived_from: [],
      scenario_id: 'test-scenario',
      event_ts: new Date().toISOString(),
    };
    return client.requestRaw('POST', '/ingest/acdp', {
      body: JSON.stringify(body),
      headers: {
        'X-ACDP-Event': 'context_published',
        'X-Tenant-Id': tenantId,
      },
    });
  }

  it('two tenants each see only their own runs via GET /runs', async () => {
    // Tenant A writes one run; tenant B writes a different one.
    const r1 = await publishEvent('tenant-a', 'run-tenant-a-1');
    expect(r1.status).toBeLessThan(300);
    const r2 = await publishEvent('tenant-b', 'run-tenant-b-1');
    expect(r2.status).toBeLessThan(300);

    // Allow processing to settle (IngestService is synchronous in V1).
    await new Promise((r) => setTimeout(r, 100));

    const clientA = new TestClient(ctx.url, 'key-a');
    const clientB = new TestClient(ctx.url, 'key-b');

    const aResp = await clientA.requestRaw('GET', '/runs');
    const bResp = await clientB.requestRaw('GET', '/runs');
    expect(aResp.status).toBe(200);
    expect(bResp.status).toBe(200);
    const aBody = aResp.body as { data: Array<{ runId: string }> };
    const bBody = bResp.body as { data: Array<{ runId: string }> };

    // Tenant A sees its run; tenant B sees its run; neither sees the
    // other's run.
    const aIds = aBody.data.map((r) => r.runId);
    const bIds = bBody.data.map((r) => r.runId);
    expect(aIds).toContain('run-tenant-a-1');
    expect(aIds).not.toContain('run-tenant-b-1');
    expect(bIds).toContain('run-tenant-b-1');
    expect(bIds).not.toContain('run-tenant-a-1');
  });

  it('GET /runs/:runId for the other tenant\'s run returns 404', async () => {
    const r = await publishEvent('tenant-a', 'run-only-a');
    expect(r.status).toBeLessThan(300);
    await new Promise((r) => setTimeout(r, 100));

    const clientB = new TestClient(ctx.url, 'key-b');
    const resp = await clientB.requestRaw('GET', '/runs/run-only-a');
    expect(resp.status).toBe(404);
  });
});
