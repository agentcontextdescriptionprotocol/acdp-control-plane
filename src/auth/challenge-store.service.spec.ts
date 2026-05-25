import { ChallengeStore, signingInputFor } from './challenge-store.service';

describe('ChallengeStore', () => {
  let store: ChallengeStore;

  beforeEach(() => {
    store = new ChallengeStore();
  });

  it('issues a challenge with the canonical signing input', () => {
    const rec = store.issue('did:web:alice', 'cp.local', 60);
    expect(rec.nonce).toBeTruthy();
    expect(rec.agentDid).toBe('did:web:alice');
    expect(rec.registryAuthority).toBe('cp.local');
    expect(rec.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(rec.signingInput).toBe(
      signingInputFor(rec.nonce, 'did:web:alice', 'cp.local', rec.expiresAt),
    );
  });

  it('consume returns the record and deletes it (single-use)', () => {
    const rec = store.issue('did:web:alice', 'cp.local', 60);
    const got = store.consume(rec.nonce);
    expect(got?.agentDid).toBe('did:web:alice');

    const second = store.consume(rec.nonce);
    expect(second).toBeNull();
  });

  it('consume returns null for unknown nonces', () => {
    expect(store.consume('not-a-real-nonce')).toBeNull();
  });

  it('consume returns null for expired records', () => {
    const rec = store.issue('did:web:alice', 'cp.local', -1); // already expired
    expect(store.consume(rec.nonce)).toBeNull();
  });

  it('size evicts expired records lazily', () => {
    store.issue('did:web:alice', 'cp.local', -10);
    store.issue('did:web:bob', 'cp.local', 60);
    expect(store.size()).toBe(1);
  });

  it('signingInputFor format pins the v1 prefix and order', () => {
    expect(signingInputFor('n', 'did:web:x', 'auth', 123)).toBe(
      'acdp-registry-auth:v1:n:did:web:x:auth:123',
    );
  });
});
