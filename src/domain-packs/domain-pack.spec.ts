import { DomainPack, DomainPackRegistry } from './domain-pack';
import { FINANCE_PACK } from './finance.pack';

const STUB_PACK: DomainPack = {
  id: 'stub',
  version: '0.0.1',
  label: 'Stub',
  agentTemplates: [
    {
      id: 'stub.agent',
      description: 'stub',
      capabilities: ['urn:acdp:cap:publish:doc:stub'],
    },
  ],
  contextTypes: [],
  searchVocab: { synonyms: {}, stopWords: [] },
};

describe('DomainPackRegistry', () => {
  let reg: DomainPackRegistry;

  beforeEach(() => {
    reg = new DomainPackRegistry();
  });

  it('register + get + list', () => {
    reg.register(STUB_PACK);
    expect(reg.get('stub')).toEqual(STUB_PACK);
    expect(reg.list()).toHaveLength(1);
  });

  it('register rejects duplicates', () => {
    reg.register(STUB_PACK);
    expect(() => reg.register(STUB_PACK)).toThrow(/already registered/);
  });

  it('allTemplates flattens across packs', () => {
    reg.register(STUB_PACK);
    reg.register(FINANCE_PACK);
    const t = reg.allTemplates();
    expect(t.length).toBe(1 + FINANCE_PACK.agentTemplates.length);
  });

  it('findTemplatesWithCapability scans every pack', () => {
    reg.register(STUB_PACK);
    reg.register(FINANCE_PACK);
    const hits = reg.findTemplatesWithCapability(
      'urn:acdp:cap:publish:data_snapshot:finance',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.packId).toBe('finance');
    expect(hits[0]!.template.id).toBe('finance.publisher');
  });
});

describe('FINANCE_PACK', () => {
  it('is a well-formed DomainPack', () => {
    expect(FINANCE_PACK.id).toBe('finance');
    expect(FINANCE_PACK.agentTemplates.length).toBeGreaterThan(0);
    for (const t of FINANCE_PACK.agentTemplates) {
      for (const c of t.capabilities) {
        expect(c).toMatch(/^urn:acdp:cap:/);
      }
    }
    for (const ct of FINANCE_PACK.contextTypes) {
      expect(ct.contextType).toMatch(/^[a-z_]+$/);
      expect(['public', 'restricted', 'private']).toContain(ct.defaultVisibility);
    }
  });
});
