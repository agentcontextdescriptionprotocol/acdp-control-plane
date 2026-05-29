import { buildDomainPackRegistry } from './domain-packs.module';

describe('buildDomainPackRegistry', () => {
  it('returns an empty registry for an empty env-string (backward compat)', () => {
    expect(buildDomainPackRegistry('').list()).toEqual([]);
    expect(buildDomainPackRegistry('   ').list()).toEqual([]);
  });

  it('registers known packs by name', () => {
    const reg = buildDomainPackRegistry('finance');
    expect(reg.list().map((p) => p.id)).toEqual(['finance']);
  });

  it('throws at construction when a name is not in the known map', () => {
    expect(() => buildDomainPackRegistry('finance,nonexistent')).toThrow(
      /Unknown domain pack 'nonexistent'/,
    );
  });

  it('throws on duplicate names', () => {
    // Backed by DomainPackRegistry.register which rejects duplicates.
    expect(() => buildDomainPackRegistry('finance,finance')).toThrow(
      /already registered/,
    );
  });

  it('tolerates whitespace and empty segments', () => {
    const reg = buildDomainPackRegistry(' finance , ,  ');
    expect(reg.list().map((p) => p.id)).toEqual(['finance']);
  });
});
