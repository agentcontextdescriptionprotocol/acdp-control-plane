import { parseQuotaConfig, resolveLimit } from './quota-config';

describe('parseQuotaConfig', () => {
  it('empty input → empty config', () => {
    expect(parseQuotaConfig('').byTenant.size).toBe(0);
    expect(parseQuotaConfig('   ').byTenant.size).toBe(0);
  });

  it('parses single-tenant single-action', () => {
    const cfg = parseQuotaConfig('tenant-a:publish=100/min');
    const t = cfg.byTenant.get('tenant-a');
    expect(t?.publish).toEqual({ count: 100, windowSeconds: 60 });
  });

  it('parses multiple actions per tenant', () => {
    const cfg = parseQuotaConfig('tenant-a:publish=100/min,run.start=10/sec');
    const t = cfg.byTenant.get('tenant-a');
    expect(t?.publish).toEqual({ count: 100, windowSeconds: 60 });
    expect(t?.['run.start']).toEqual({ count: 10, windowSeconds: 1 });
  });

  it('parses multiple tenants separated by `;`', () => {
    const cfg = parseQuotaConfig(
      'tenant-a:publish=100/min;tenant-b:publish=500/min',
    );
    expect(cfg.byTenant.get('tenant-a')?.publish?.count).toBe(100);
    expect(cfg.byTenant.get('tenant-b')?.publish?.count).toBe(500);
  });

  it('parses the * wildcard', () => {
    const cfg = parseQuotaConfig('tenant-a:*=1000/hour');
    expect(cfg.byTenant.get('tenant-a')?.['*']).toEqual({ count: 1000, windowSeconds: 3600 });
  });

  it('rejects unknown action', () => {
    expect(() => parseQuotaConfig('t:foo=1/min')).toThrow(/unknown action/);
  });

  it('rejects malformed rate (no slash)', () => {
    expect(() => parseQuotaConfig('t:publish=100')).toThrow(/count\/window/);
  });

  it('rejects unknown window unit', () => {
    expect(() => parseQuotaConfig('t:publish=100/day')).toThrow(/sec, min, hour/);
  });

  it('rejects non-positive integer count', () => {
    expect(() => parseQuotaConfig('t:publish=0/min')).toThrow(/positive integer/);
    expect(() => parseQuotaConfig('t:publish=-1/min')).toThrow(/positive integer/);
    expect(() => parseQuotaConfig('t:publish=1.5/min')).toThrow(/positive integer/);
  });

  it('rejects empty tenant or limits', () => {
    expect(() => parseQuotaConfig(':publish=1/min')).toThrow(/tenantId:/);
    expect(() => parseQuotaConfig('t:')).toThrow(/empty .* limits/);
  });
});

describe('resolveLimit', () => {
  const cfg = parseQuotaConfig(
    'tenant-a:publish=100/min,*=1000/hour;tenant-b:run.start=5/sec',
  );

  it('returns explicit action limit when present', () => {
    expect(resolveLimit(cfg, 'tenant-a', 'publish')).toEqual({
      count: 100,
      windowSeconds: 60,
    });
  });

  it('falls back to wildcard when action has no explicit rule', () => {
    expect(resolveLimit(cfg, 'tenant-a', 'run.start')).toEqual({
      count: 1000,
      windowSeconds: 3600,
    });
  });

  it('returns null when tenant has no rules', () => {
    expect(resolveLimit(cfg, 'unknown-tenant', 'publish')).toBeNull();
  });

  it('returns null when tenant has rules but neither action nor * matches', () => {
    expect(resolveLimit(cfg, 'tenant-b', 'publish')).toBeNull();
  });
});
