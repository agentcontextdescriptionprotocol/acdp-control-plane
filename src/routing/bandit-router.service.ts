/**
 * Thompson Sampling bandit router (#5).
 *
 * Per the deferred plan, the bandit is the V2 routing-by-reward
 * primitive. It maintains a Beta posterior per `(taskClass, agentDid)`
 * arm: every successful reward bumps `alpha`, every failure bumps
 * `beta`. On `route()`, we draw one sample from each arm's posterior
 * and pick the highest — that's classic Thompson Sampling.
 *
 * Fairness/safety guard: arms whose capability declaration doesn't
 * cover the task (per #4 capability registry) are filtered out
 * BEFORE sampling — the bandit can never route a task to an agent
 * that hasn't declared the capability.
 *
 * Exploration cap: configurable fraction of traffic uses a uniform
 * random arm instead of Thompson sampling, surfacing under-explored
 * arms even when one has converged. Default 0.05 (5%); operators
 * can tune via `BANDIT_EXPLORATION_FRACTION` env var.
 *
 * Reward channel: callers invoke `recordReward(taskClass, agentDid,
 * reward)` after the agent's work completes. `reward` is in `[0, 1]`
 * — 1 = good outcome, 0 = bad. The deferred plan notes that a real
 * reward channel doesn't exist yet (no quality scoring on run
 * events), so the bandit ships as scaffolding; once #5 reward
 * pipeline lands the same code path drives real routing.
 *
 * State is in-memory in V1. Multi-instance deployments need a shared
 * store (Redis hash per arm); deferred until the bandit is actually
 * driving traffic.
 */
import { Injectable, Logger } from '@nestjs/common';

export interface BanditArm {
  taskClass: string;
  agentDid: string;
  /** Beta(alpha, beta) — alpha = 1 + successes, beta = 1 + failures. */
  alpha: number;
  beta: number;
}

export interface RouteRequest {
  taskClass: string;
  /** Candidates, pre-filtered by capability match (callers enforce). */
  candidates: ReadonlyArray<string>;
  /** Optional override of the exploration cap for this call. */
  explorationFraction?: number;
}

export interface RouteResult {
  agentDid: string;
  reason: 'thompson' | 'explore' | 'forced_only_candidate';
  /** The sampled value (for diagnostics). */
  sample?: number;
}

@Injectable()
export class BanditRouter {
  private readonly logger = new Logger(BanditRouter.name);
  private readonly arms = new Map<string, BanditArm>();
  private readonly defaultExploration: number;

  constructor(opts: { explorationFraction?: number } = {}) {
    this.defaultExploration = clamp01(opts.explorationFraction ?? 0.05);
  }

  /**
   * Pick an agent for one task. Returns null when no candidates are
   * supplied — caller decides whether to fall back to manual routing.
   */
  route(req: RouteRequest): RouteResult | null {
    if (req.candidates.length === 0) return null;
    if (req.candidates.length === 1) {
      return { agentDid: req.candidates[0]!, reason: 'forced_only_candidate' };
    }

    const explore = req.explorationFraction ?? this.defaultExploration;
    if (Math.random() < explore) {
      const i = Math.floor(Math.random() * req.candidates.length);
      return { agentDid: req.candidates[i]!, reason: 'explore' };
    }

    // Thompson sampling: draw one sample per arm, pick the max.
    let best: { did: string; sample: number } | null = null;
    for (const did of req.candidates) {
      const arm = this.armFor(req.taskClass, did);
      const sample = sampleBeta(arm.alpha, arm.beta);
      if (best === null || sample > best.sample) {
        best = { did, sample };
      }
    }
    return { agentDid: best!.did, reason: 'thompson', sample: best!.sample };
  }

  /**
   * Record a reward signal for an arm. `reward` is clamped to [0,1];
   * counts as a Bernoulli outcome at the value (so 0.5 is half a
   * success + half a failure — the closest principled interpretation
   * for a continuous reward).
   */
  recordReward(taskClass: string, agentDid: string, reward: number): void {
    const r = clamp01(reward);
    const arm = this.armFor(taskClass, agentDid);
    arm.alpha += r;
    arm.beta += 1 - r;
  }

  /** Snapshot the current arm state. Useful for /metrics and tests. */
  snapshot(): ReadonlyArray<BanditArm> {
    return Array.from(this.arms.values());
  }

  /** Read the current arm state (creates a fresh Beta(1,1) on first touch). */
  armFor(taskClass: string, agentDid: string): BanditArm {
    const key = `${taskClass}::${agentDid}`;
    let arm = this.arms.get(key);
    if (!arm) {
      arm = { taskClass, agentDid, alpha: 1, beta: 1 };
      this.arms.set(key, arm);
    }
    return arm;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Sample one value from Beta(alpha, beta).
 *
 * Uses the relationship Beta(a, b) = Gamma(a) / (Gamma(a) + Gamma(b)).
 * Gamma sampling via Marsaglia + Tsang's method for shape ≥ 1, with
 * a Johnk-style rejection for shape < 1 (we keep priors at 1 so we
 * never actually trip the < 1 case in V1, but the helper covers it
 * to stay defensive).
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Ahrens-Dieter rejection — rare path, but safe.
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  // Marsaglia + Tsang 2000.
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
   
  while (true) {
    const xNorm = standardNormal();
    const v = Math.pow(1 + c * xNorm, 3);
    if (v <= 0) continue;
    const u = Math.random();
    if (u < 1 - 0.0331 * Math.pow(xNorm, 4)) return d * v;
    if (Math.log(u) < 0.5 * xNorm * xNorm + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

function standardNormal(): number {
  // Box-Muller. `Math.random()` is fine for V1 routing; cryptographic
  // randomness is overkill and slower.
  const u1 = Math.max(Math.random(), Number.MIN_VALUE);
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
