/**
 * Global policy module — registers a `PolicyDecider` keyed by the
 * `POLICY_DECIDER` injection symbol. Wraps the static-rules impl in
 * the LRU caching wrapper so hot-path consumers (PolicyGuard on
 * every request) hit cache instead of recomputing.
 *
 * V1 ships with the static-rules backend; future packs / OPA backends
 * swap by providing a different `POLICY_DECIDER` provider.
 */
import { Global, Module } from '@nestjs/common';
import { CachingPolicyDecider } from './caching-policy.decider';
import { POLICY_DECIDER } from './policy-decider';
import { PolicyGuard } from './policy.guard';
import { StaticRulesPolicyDecider } from './static-rules-policy.decider';

@Global()
@Module({
  providers: [
    {
      provide: POLICY_DECIDER,
      useFactory: () =>
        // V1 has no per-action scope requirements and no resource-tenant
        // lookup. Both are configurable; deferred until consumers care.
        new CachingPolicyDecider(new StaticRulesPolicyDecider({}), {
          ttlMs: 5_000,
          maxEntries: 10_000,
        }),
    },
    PolicyGuard,
  ],
  exports: [POLICY_DECIDER, PolicyGuard],
})
export class PolicyModule {}
