import {
  DEFAULT_TENANT_ID,
  buildTenantLookup,
  parseTenantApiKeys,
} from './tenant-context';

describe('parseTenantApiKeys', () => {
  it('parses tenant-prefixed entries', () => {
    const out = parseTenantApiKeys('tenant-a:key1,tenant-b:key2');
    expect(out).toEqual([
      { tenantId: 'tenant-a', apiKey: 'key1' },
      { tenantId: 'tenant-b', apiKey: 'key2' },
    ]);
  });

  it('treats bare keys as the default tenant', () => {
    const out = parseTenantApiKeys('bareKey,tenant-a:key1');
    expect(out).toEqual([
      { tenantId: DEFAULT_TENANT_ID, apiKey: 'bareKey' },
      { tenantId: 'tenant-a', apiKey: 'key1' },
    ]);
  });

  it('returns [] for an empty value', () => {
    expect(parseTenantApiKeys('')).toEqual([]);
    expect(parseTenantApiKeys('   ')).toEqual([]);
  });

  it('rejects an empty tenant or key', () => {
    expect(() => parseTenantApiKeys(':key')).toThrow(/empty side/);
    expect(() => parseTenantApiKeys('tenant:')).toThrow(/empty side/);
  });

  it('trims surrounding whitespace', () => {
    expect(parseTenantApiKeys(' tenant-a : key1 ')).toEqual([
      { tenantId: 'tenant-a', apiKey: 'key1' },
    ]);
  });

  it('preserves colons after the first (in case a key contains one)', () => {
    expect(parseTenantApiKeys('tenant-a:weird:key:value')).toEqual([
      { tenantId: 'tenant-a', apiKey: 'weird:key:value' },
    ]);
  });
});

describe('buildTenantLookup', () => {
  it('builds an apiKey → tenantId map', () => {
    const m = buildTenantLookup([
      { tenantId: 'a', apiKey: 'k1' },
      { tenantId: 'b', apiKey: 'k2' },
    ]);
    expect(m.get('k1')).toBe('a');
    expect(m.get('k2')).toBe('b');
    expect(m.get('k-none')).toBeUndefined();
  });

  it('allows duplicate (tenant, key) pairs (idempotent)', () => {
    expect(() =>
      buildTenantLookup([
        { tenantId: 'a', apiKey: 'k1' },
        { tenantId: 'a', apiKey: 'k1' },
      ]),
    ).not.toThrow();
  });

  it('rejects same key assigned to different tenants (privilege escalation vector)', () => {
    expect(() =>
      buildTenantLookup([
        { tenantId: 'a', apiKey: 'k1' },
        { tenantId: 'b', apiKey: 'k1' },
      ]),
    ).toThrow(/multiple tenants/);
  });
});
