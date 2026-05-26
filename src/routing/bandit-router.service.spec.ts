import { BanditRouter } from './bandit-router.service';

describe('BanditRouter', () => {
  it('returns null for an empty candidate list', () => {
    const r = new BanditRouter();
    expect(r.route({ taskClass: 'x', candidates: [] })).toBeNull();
  });

  it('returns the single candidate when only one is supplied', () => {
    const r = new BanditRouter();
    const out = r.route({ taskClass: 'x', candidates: ['did:web:a'] });
    expect(out?.agentDid).toBe('did:web:a');
    expect(out?.reason).toBe('forced_only_candidate');
  });

  it('explorationFraction=1 always returns "explore"', () => {
    const r = new BanditRouter();
    for (let i = 0; i < 10; i++) {
      const out = r.route({
        taskClass: 'x',
        candidates: ['did:web:a', 'did:web:b'],
        explorationFraction: 1,
      });
      expect(out?.reason).toBe('explore');
    }
  });

  it('explorationFraction=0 always returns "thompson"', () => {
    const r = new BanditRouter();
    for (let i = 0; i < 10; i++) {
      const out = r.route({
        taskClass: 'x',
        candidates: ['did:web:a', 'did:web:b'],
        explorationFraction: 0,
      });
      expect(out?.reason).toBe('thompson');
      expect(out?.sample).toBeGreaterThanOrEqual(0);
      expect(out?.sample).toBeLessThanOrEqual(1);
    }
  });

  it('recordReward updates the right arm', () => {
    const r = new BanditRouter();
    r.recordReward('x', 'did:web:a', 1);
    r.recordReward('x', 'did:web:a', 1);
    r.recordReward('x', 'did:web:a', 0);
    const arm = r.armFor('x', 'did:web:a');
    expect(arm.alpha).toBeCloseTo(3); // 1 (prior) + 2 successes
    expect(arm.beta).toBeCloseTo(2);  // 1 (prior) + 1 failure
  });

  it('rewards outside [0,1] are clamped', () => {
    const r = new BanditRouter();
    r.recordReward('x', 'did:web:a', 5);
    r.recordReward('x', 'did:web:a', -3);
    const arm = r.armFor('x', 'did:web:a');
    expect(arm.alpha).toBeCloseTo(2); // 1 + 1 (clamped 5 → 1)
    expect(arm.beta).toBeCloseTo(2);  // 1 + 1 (clamped -3 → 0)
  });

  it('converges to the better arm under repeated rewards', () => {
    // Bandit smoke test: arm A always succeeds, arm B always fails.
    // After 100 rewards, A should dominate B in expected pick rate.
    const r = new BanditRouter();
    for (let i = 0; i < 100; i++) {
      r.recordReward('x', 'did:web:a', 1);
      r.recordReward('x', 'did:web:b', 0);
    }
    let aWins = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const out = r.route({
        taskClass: 'x',
        candidates: ['did:web:a', 'did:web:b'],
        explorationFraction: 0,
      });
      if (out?.agentDid === 'did:web:a') aWins++;
    }
    // With heavy reward asymmetry, A should win the vast majority.
    expect(aWins).toBeGreaterThan(trials * 0.9);
  });

  it('separates arms by taskClass (rewards do not bleed across classes)', () => {
    const r = new BanditRouter();
    r.recordReward('class-A', 'did:web:a', 1);
    r.recordReward('class-A', 'did:web:a', 1);
    expect(r.armFor('class-A', 'did:web:a').alpha).toBeCloseTo(3);
    expect(r.armFor('class-B', 'did:web:a').alpha).toBeCloseTo(1); // fresh prior
  });

  it('snapshot reflects all touched arms', () => {
    const r = new BanditRouter();
    r.recordReward('x', 'did:web:a', 1);
    r.recordReward('y', 'did:web:b', 0);
    const snap = r.snapshot();
    expect(snap.map((a) => `${a.taskClass}/${a.agentDid}`).sort()).toEqual([
      'x/did:web:a',
      'y/did:web:b',
    ]);
  });
});
