import { AuthSweeperService } from './auth-sweeper.service';
import { InMemoryChallengeRepository } from './in-memory-challenge.repository';
import { InMemoryRevocationRepository } from './in-memory-revocation.repository';
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('AuthSweeperService', () => {
  let challenges: InMemoryChallengeRepository;
  let revocations: InMemoryRevocationRepository;
  let sweeper: AuthSweeperService;

  beforeEach(() => {
    challenges = new InMemoryChallengeRepository();
    revocations = new InMemoryRevocationRepository();
    sweeper = new AuthSweeperService(
      { authSweepIntervalSeconds: 0 } as any, // disable setInterval
      challenges,
      revocations,
    );
  });

  it('sweepOnce evicts expired entries from both stores', async () => {
    const past = Math.floor(Date.now() / 1000) - 5;
    await challenges.put({
      nonce: 'n-old',
      agentDid: 'did:web:a',
      registryAuthority: 'cp',
      signingInput: 'x',
      expiresAt: past,
    });
    await revocations.revoke({
      jti: 'j-old',
      sub: 'did:web:a',
      iss: 'cp',
      exp: past,
      revokedBy: 't',
      reason: 'admin_revoke',
    });
    const res = await sweeper.sweepOnce();
    expect(res.challenges).toBe(1);
    expect(res.revocations).toBe(1);
  });

  it('sweepOnce ignores per-store errors without failing the other', async () => {
    const broken = {
      evictExpired: jest.fn().mockRejectedValue(new Error('db down')),
    } as any;
    const okRevocations = new InMemoryRevocationRepository();
    await okRevocations.revoke({
      jti: 'j',
      sub: 's',
      iss: 'cp',
      exp: Math.floor(Date.now() / 1000) - 1,
      revokedBy: 't',
      reason: 'admin_revoke',
    });
    const s = new AuthSweeperService(
      { authSweepIntervalSeconds: 0 } as any,
      broken,
      okRevocations,
    );
    const res = await s.sweepOnce();
    expect(res.challenges).toBe(0);
    expect(res.revocations).toBe(1);
  });

  it('onModuleInit + onModuleDestroy is a no-op when interval is 0', () => {
    expect(() => {
      sweeper.onModuleInit();
      sweeper.onModuleDestroy();
    }).not.toThrow();
  });
});
