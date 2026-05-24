import { createTestApp, TestAppContext } from '../helpers/test-app';
import { TestSSEClient } from '../helpers/sse-client';

const SECRET = 'stream-secret';

function event(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'context_published',
    ctx_id: 'acdp://registry-a/c-' + Math.random().toString(36).slice(2, 10),
    agent_id: 'did:web:agent-stream.example',
    context_type: 'task',
    visibility: 'public',
    version: 1,
    derived_from: [],
    registry_authority: 'registry-a.example',
    scenario_id: 'stream-scenario',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('SSE streams (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp({ webhookSecret: SECRET });
  });

  beforeEach(async () => {
    await ctx.cleanup();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('per-run SSE stream emits events for that run only', async () => {
    const runId = 'run-stream-1';
    const otherRunId = 'run-stream-other';

    const sse = new TestSSEClient(ctx.url, 'test-key');
    await sse.connect(`/runs/${runId}/events/stream`);

    try {
      // Give the subscription a tick to register on the StreamHub.
      await new Promise((r) => setTimeout(r, 50));

      // Other-run events must NOT appear on this stream.
      await ctx.client.ingest(event(), { runId: otherRunId, secret: SECRET });

      // In-scope events: should appear with the original event type.
      await ctx.client.ingest(event(), { runId, secret: SECRET });
      const e = await sse.waitForEvent('context_published', 5000);

      expect(e.type).toBe('context_published');
      const data = e.data as Record<string, unknown>;
      expect(data.runId).toBe(runId);

      // Only one non-heartbeat event so far on this stream.
      expect(sse.getDataEvents().length).toBe(1);
    } finally {
      sse.close();
    }
  });

  it('global SSE stream emits every ingested event', async () => {
    const sse = new TestSSEClient(ctx.url, 'test-key');
    await sse.connect('/events/stream');

    try {
      await new Promise((r) => setTimeout(r, 50));
      await ctx.client.ingest(event(), { runId: 'g-1', secret: SECRET });
      await ctx.client.ingest(event(), { runId: 'g-2', secret: SECRET });

      // Wait for both to land.
      for (let i = 0; i < 20 && sse.getDataEvents().length < 2; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const data = sse.getDataEvents();
      expect(data.length).toBe(2);
      expect(data.every((e) => e.type === 'context_published')).toBe(true);
    } finally {
      sse.close();
    }
  });
});
