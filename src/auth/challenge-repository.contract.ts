/**
 * Shared contract test suite for any ChallengeRepository implementation.
 *
 * Both `InMemoryChallengeRepository` and `PostgresChallengeRepository`
 * import this and pass a factory that returns a fresh instance. The
 * spec asserts the behavioral guarantees the rest of the code (chiefly
 * `TokenIssuer`) depends on:
 *
 *   - `put()` then `take()` returns the same record exactly once.
 *   - `take()` is atomic under concurrent calls — only one caller
 *     sees the record (this is the property that defends against a
 *     race-condition replay attack in multi-instance deployments).
 *   - Expired records are returned as null on `take()` and are
 *     swept by `evictExpired()`.
 *   - `size()` reflects live (non-expired) entries.
 */
import {
  ChallengeRecord,
  ChallengeRepository,
} from './challenge-repository';

function record(overrides: Partial<ChallengeRecord> = {}): ChallengeRecord {
  const now = Math.floor(Date.now() / 1000);
  const nonce = overrides.nonce ?? `n-${Math.random().toString(36).slice(2)}`;
  return {
    nonce,
    agentDid: overrides.agentDid ?? 'did:web:alice',
    registryAuthority: overrides.registryAuthority ?? 'cp.local',
    signingInput: overrides.signingInput ?? `acdp-registry-auth:v1:${nonce}:x:y:z`,
    expiresAt: overrides.expiresAt ?? now + 60,
  };
}

export function runChallengeRepositoryContract(
  newRepo: () => Promise<ChallengeRepository>,
): void {
  let repo: ChallengeRepository;

  beforeEach(async () => {
    repo = await newRepo();
  });

  it('put → take returns the record once', async () => {
    const rec = record();
    await repo.put(rec);
    const got = await repo.take(rec.nonce);
    expect(got).not.toBeNull();
    expect(got?.nonce).toBe(rec.nonce);
    expect(got?.agentDid).toBe(rec.agentDid);

    const second = await repo.take(rec.nonce);
    expect(second).toBeNull();
  });

  it('take returns null for unknown nonces', async () => {
    expect(await repo.take('never-existed')).toBeNull();
  });

  it('take returns null for expired records', async () => {
    const rec = record({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
    await repo.put(rec);
    expect(await repo.take(rec.nonce)).toBeNull();
  });

  it('evictExpired drops only expired entries and returns the count', async () => {
    const now = Math.floor(Date.now() / 1000);
    await repo.put(record({ nonce: 'fresh', expiresAt: now + 60 }));
    await repo.put(record({ nonce: 'old-1', expiresAt: now - 10 }));
    await repo.put(record({ nonce: 'old-2', expiresAt: now - 20 }));
    const evicted = await repo.evictExpired();
    expect(evicted).toBe(2);
    expect(await repo.take('fresh')).not.toBeNull();
    expect(await repo.take('old-1')).toBeNull();
  });

  it('size reflects live entries', async () => {
    const now = Math.floor(Date.now() / 1000);
    await repo.put(record({ nonce: 'a', expiresAt: now + 60 }));
    await repo.put(record({ nonce: 'b', expiresAt: now + 60 }));
    await repo.put(record({ nonce: 'c', expiresAt: now - 10 }));
    // evictExpired runs implicitly inside size() for the in-memory
    // impl; postgres counts via SQL with the expiry predicate.
    const live = await repo.size();
    expect(live).toBe(2);
  });

  it('atomic take: only one of two concurrent calls observes the record', async () => {
    const rec = record();
    await repo.put(rec);
    const [a, b] = await Promise.all([
      repo.take(rec.nonce),
      repo.take(rec.nonce),
    ]);
    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
  });
}
