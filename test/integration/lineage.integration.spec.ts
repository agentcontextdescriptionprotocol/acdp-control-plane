import { createTestApp, TestAppContext } from '../helpers/test-app';

const SECRET = 'lineage-test-secret';

function event(
  ctxId: string,
  derivedFrom: string[],
  agentId = 'did:web:agent-a.example',
) {
  return {
    type: 'context_published',
    ctx_id: ctxId,
    lineage_id: 'lin-1',
    agent_id: agentId,
    context_type: 'observation',
    visibility: 'public',
    version: 1,
    derived_from: derivedFrom,
    registry_authority: 'registry-a.example',
    scenario_id: 'lineage-scenario',
    created_at: new Date().toISOString(),
  };
}

describe('Lineage DAG (integration)', () => {
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

  it('builds a DAG of nodes (context_published events) and directed edges (derived_from)', async () => {
    const runId = 'run-lineage-1';
    //   c1 ──┐
    //         ├──► c3
    //   c2 ──┘
    //               └──► c4
    await ctx.client.ingest(event('acdp://registry-a/c1', []), { runId, secret: SECRET });
    await ctx.client.ingest(event('acdp://registry-a/c2', []), { runId, secret: SECRET });
    await ctx.client.ingest(
      event('acdp://registry-a/c3', ['acdp://registry-a/c1', 'acdp://registry-a/c2']),
      { runId, secret: SECRET },
    );
    await ctx.client.ingest(event('acdp://registry-a/c4', ['acdp://registry-a/c3']), {
      runId,
      secret: SECRET,
    });

    const dag = (await ctx.client.getLineage(runId)) as {
      runId: string;
      nodes: Array<{ ctxId: string }>;
      edges: Array<{ from: string; to: string }>;
    };

    expect(dag.runId).toBe(runId);
    expect(dag.nodes.map((n) => n.ctxId).sort()).toEqual([
      'acdp://registry-a/c1',
      'acdp://registry-a/c2',
      'acdp://registry-a/c3',
      'acdp://registry-a/c4',
    ]);
    expect(dag.edges).toEqual(
      expect.arrayContaining([
        { from: 'acdp://registry-a/c1', to: 'acdp://registry-a/c3' },
        { from: 'acdp://registry-a/c2', to: 'acdp://registry-a/c3' },
        { from: 'acdp://registry-a/c3', to: 'acdp://registry-a/c4' },
      ]),
    );
    expect(dag.edges.length).toBe(3);
  });

  it('returns an empty DAG for a run with no published contexts', async () => {
    const runId = 'run-lineage-empty';
    await ctx.client.ingest(
      {
        type: 'context_archived',
        ctx_id: 'acdp://registry-a/c-archived',
        agent_id: 'did:web:agent-a.example',
        registry_authority: 'registry-a.example',
        scenario_id: 's',
        created_at: new Date().toISOString(),
      },
      { runId, secret: SECRET },
    );
    const dag = (await ctx.client.getLineage(runId)) as {
      nodes: unknown[];
      edges: unknown[];
    };
    expect(dag.nodes).toEqual([]);
    expect(dag.edges).toEqual([]);
  });

  it('does not duplicate lineage edges when the same event is re-ingested', async () => {
    const runId = 'run-lineage-dedup';
    const ev = event('acdp://registry-a/c2', ['acdp://registry-a/c1']);
    await ctx.client.ingest(event('acdp://registry-a/c1', []), { runId, secret: SECRET });
    await ctx.client.ingest(ev, { runId, secret: SECRET });
    await ctx.client.ingest(ev, { runId, secret: SECRET });

    const dag = (await ctx.client.getLineage(runId)) as {
      edges: Array<{ from: string; to: string }>;
    };
    expect(dag.edges).toEqual([
      { from: 'acdp://registry-a/c1', to: 'acdp://registry-a/c2' },
    ]);
  });
});
