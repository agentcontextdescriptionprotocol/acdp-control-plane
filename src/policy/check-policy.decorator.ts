/**
 * `@CheckPolicy(action)` — attach a policy-action label to a handler.
 *
 * The `PolicyGuard` reads this metadata on every request, builds a
 * `PolicyRequest` from the request context, and calls the registered
 * `PolicyDecider`. A handler without `@CheckPolicy()` is unconditionally
 * allowed (after the AuthGuard already passed); decorate explicitly.
 */
import { SetMetadata } from '@nestjs/common';
import { PolicyAction } from './policy-decider';

export const POLICY_ACTION_KEY = 'acdp.policy.action';

export const CheckPolicy = (action: PolicyAction) =>
  SetMetadata(POLICY_ACTION_KEY, action);
