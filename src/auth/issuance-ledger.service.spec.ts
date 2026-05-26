/* eslint-disable @typescript-eslint/no-explicit-any */
import { IssuanceLedgerService } from './issuance-ledger.service';

function newLedger(): IssuanceLedgerService {
  return new IssuanceLedgerService(
    { authPersistence: 'memory' } as any,
    {} as any,
  );
}

describe('IssuanceLedgerService (memory chain)', () => {
  it('records entries and builds a SHA-256 chain', () => {
    const l = newLedger();
    l.record({ decision: 'mint', jti: 'a', sub: 'did:web:x', iss: 'cp.test' });
    l.record({ decision: 'reject_signature', sub: 'did:web:y' });
    const snap = l.__snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].prevHash).toMatch(/^0+$/);
    expect(snap[0].entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap[1].prevHash).toBe(snap[0].entryHash);
    expect(snap[1].entryHash).not.toBe(snap[0].entryHash);
  });

  it('verifyChain returns ok=true for an untampered chain', async () => {
    const l = newLedger();
    for (let i = 0; i < 5; i++) {
      l.record({ decision: 'mint', jti: `j-${i}`, sub: 'did:web:x' });
    }
    const v = await l.verifyChain();
    expect(v.ok).toBe(true);
    expect(v.firstBroken).toBe(-1);
    expect(v.total).toBe(5);
  });

  it('verifyChain returns the first-broken index when a row is tampered', async () => {
    const l = newLedger();
    for (let i = 0; i < 5; i++) {
      l.record({ decision: 'mint', jti: `j-${i}`, sub: 'did:web:x' });
    }
    l.__tamper(2, (row) => {
      row.sub = 'did:web:attacker';
    });
    const v = await l.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.firstBroken).toBe(2);
    expect(v.total).toBe(5);
  });

  it('record(): never throws even when ledger is constructed without a usable DB', () => {
    const l = newLedger();
    expect(() => l.record({ decision: 'mint' })).not.toThrow();
  });

  it('different decisions produce different hashes for otherwise-identical inputs', () => {
    const a = newLedger();
    a.record({ decision: 'mint', jti: 'x' });
    const b = newLedger();
    b.record({ decision: 'reject_signature', jti: 'x' });
    expect(a.__snapshot()[0].entryHash).not.toBe(b.__snapshot()[0].entryHash);
  });

  it('verifyChain returns ok=true for an empty ledger', async () => {
    const l = newLedger();
    expect((await l.verifyChain()).ok).toBe(true);
  });

  it('drain() resolves immediately when no postgres writes are pending', async () => {
    const l = newLedger();
    l.record({ decision: 'mint', jti: 'x' });
    await expect(l.drain()).resolves.toBeUndefined();
  });
});
