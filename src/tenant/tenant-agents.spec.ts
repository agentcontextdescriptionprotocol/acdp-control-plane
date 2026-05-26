import {
  buildAgentTenantLookup,
  parseTenantAgents,
  tenantForAgent,
  TenantAgentsConfigError,
} from './tenant-agents';

describe('parseTenantAgents', () => {
  it('parses a single binding', () => {
    expect(parseTenantAgents('tenant-a:did:web:alice')).toEqual([
      { tenantId: 'tenant-a', agentDid: 'did:web:alice' },
    ]);
  });

  it('parses multiple comma-separated bindings', () => {
    expect(parseTenantAgents('tenant-a:did:web:alice,tenant-b:did:web:bob')).toEqual([
      { tenantId: 'tenant-a', agentDid: 'did:web:alice' },
      { tenantId: 'tenant-b', agentDid: 'did:web:bob' },
    ]);
  });

  it('returns empty array for empty / whitespace input', () => {
    expect(parseTenantAgents('')).toEqual([]);
    expect(parseTenantAgents('   ')).toEqual([]);
  });

  it('rejects entries without a colon', () => {
    expect(() => parseTenantAgents('no-colon')).toThrow(TenantAgentsConfigError);
  });

  it('rejects entries with empty tenant or did', () => {
    expect(() => parseTenantAgents(':did:web:alice')).toThrow(TenantAgentsConfigError);
    expect(() => parseTenantAgents('tenant-a:')).toThrow(TenantAgentsConfigError);
  });

  it('preserves colons in the DID (split-on-first-colon semantics)', () => {
    expect(parseTenantAgents('tenant-a:did:web:agents.example:alice')).toEqual([
      {
        tenantId: 'tenant-a',
        agentDid: 'did:web:agents.example:alice',
      },
    ]);
  });
});

describe('buildAgentTenantLookup', () => {
  it('rejects an agent_did mapped to two distinct tenants', () => {
    expect(() =>
      buildAgentTenantLookup([
        { tenantId: 'a', agentDid: 'did:web:alice' },
        { tenantId: 'b', agentDid: 'did:web:alice' },
      ]),
    ).toThrow(TenantAgentsConfigError);
  });

  it('idempotent duplicate is fine (same tenant twice)', () => {
    const m = buildAgentTenantLookup([
      { tenantId: 'a', agentDid: 'did:web:alice' },
      { tenantId: 'a', agentDid: 'did:web:alice' },
    ]);
    expect(m.size).toBe(1);
  });
});

describe('tenantForAgent', () => {
  it('returns the mapped tenant', () => {
    const m = buildAgentTenantLookup([
      { tenantId: 'tenant-a', agentDid: 'did:web:alice' },
    ]);
    expect(tenantForAgent(m, 'did:web:alice')).toBe('tenant-a');
  });

  it('falls back to default for unlisted agents', () => {
    expect(tenantForAgent(new Map(), 'did:web:unknown')).toBe('default');
  });
});
