/**
 * `@CheckQuota(action)` — attach a quota-action label to a handler so
 * `QuotaGuard` enforces the per-tenant limit configured in
 * `TENANT_QUOTAS`. Handlers without the decorator are unconditionally
 * allowed (auth and policy gates still apply).
 */
import { SetMetadata } from '@nestjs/common';
import { QuotaAction } from './quota-config';

export const QUOTA_ACTION_KEY = 'acdp.quota.action';

export const CheckQuota = (action: QuotaAction) =>
  SetMetadata(QUOTA_ACTION_KEY, action);
