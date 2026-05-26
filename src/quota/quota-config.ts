/**
 * Per-tenant quota configuration.
 *
 * Wire format (env-driven; a tenant_quotas DB table is the natural
 * follow-up once an admin UI exists):
 *
 *   TENANT_QUOTAS=tenant-a:publish=100/min,run.start=10/min;tenant-b:publish=500/min
 *
 * Grammar:
 *   - Tenants separated by `;`
 *   - Within a tenant: `tenantId:action=count/window[,action=count/window]...`
 *   - Window: `sec` | `min` | `hour`
 *   - Action: any QuotaAction value below
 *
 * A tenant without an entry falls back to `defaultLimits` (no env =
 * no limit, i.e. quotas disabled). A `*` wildcard applies to any
 * action not explicitly listed for the tenant.
 *
 * Examples:
 *   TENANT_QUOTAS=tenant-a:publish=100/min
 *     → tenant-a is limited to 100 publishes/min; everything else
 *       unlimited
 *
 *   TENANT_QUOTAS=tenant-a:*=1000/min,publish=100/min
 *     → tenant-a: 100 publishes/min, 1000 of any other action/min
 */

export type QuotaAction =
  | 'publish'
  | 'run.start'
  | 'capability.declare'
  | 'token.issue';

export type QuotaWindow = 'sec' | 'min' | 'hour';

export interface QuotaLimit {
  count: number;
  /** Window length in seconds. Derived from the parsed window unit. */
  windowSeconds: number;
}

export type TenantLimits = Partial<Record<QuotaAction | '*', QuotaLimit>>;

export interface ParsedQuotaConfig {
  /** tenantId → action → limit. */
  byTenant: Map<string, TenantLimits>;
}

export class QuotaConfigError extends Error {}

const WINDOW_SECONDS: Record<QuotaWindow, number> = {
  sec: 1,
  min: 60,
  hour: 3600,
};

const VALID_ACTIONS: ReadonlySet<string> = new Set<string>([
  'publish',
  'run.start',
  'capability.declare',
  'token.issue',
  '*',
]);

export function parseQuotaConfig(raw: string): ParsedQuotaConfig {
  const byTenant = new Map<string, TenantLimits>();
  if (!raw.trim()) return { byTenant };

  for (const tenantBlock of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const colonIx = tenantBlock.indexOf(':');
    if (colonIx <= 0) {
      throw new QuotaConfigError(
        `TENANT_QUOTAS block '${tenantBlock}' missing 'tenantId:' prefix`,
      );
    }
    const tenantId = tenantBlock.slice(0, colonIx).trim();
    const limitsStr = tenantBlock.slice(colonIx + 1).trim();
    if (!tenantId || !limitsStr) {
      throw new QuotaConfigError(
        `TENANT_QUOTAS block '${tenantBlock}' has empty tenantId or limits`,
      );
    }
    const limits: TenantLimits = {};
    for (const entry of limitsStr.split(',').map((s) => s.trim()).filter(Boolean)) {
      const { action, limit } = parseLimitEntry(entry, tenantId);
      limits[action] = limit;
    }
    byTenant.set(tenantId, limits);
  }
  return { byTenant };
}

function parseLimitEntry(
  entry: string,
  tenantId: string,
): { action: QuotaAction | '*'; limit: QuotaLimit } {
  const eqIx = entry.indexOf('=');
  if (eqIx <= 0) {
    throw new QuotaConfigError(
      `TENANT_QUOTAS entry '${entry}' for tenant '${tenantId}' missing 'action=count/window'`,
    );
  }
  const action = entry.slice(0, eqIx).trim() as QuotaAction | '*';
  if (!VALID_ACTIONS.has(action)) {
    throw new QuotaConfigError(
      `TENANT_QUOTAS entry '${entry}' for tenant '${tenantId}': unknown action '${action}'. ` +
        `Allowed: ${Array.from(VALID_ACTIONS).join(', ')}`,
    );
  }
  const rate = entry.slice(eqIx + 1).trim();
  const slashIx = rate.indexOf('/');
  if (slashIx <= 0) {
    throw new QuotaConfigError(
      `TENANT_QUOTAS entry '${entry}' for tenant '${tenantId}': rate must be 'count/window' (got '${rate}')`,
    );
  }
  const countStr = rate.slice(0, slashIx).trim();
  const windowStr = rate.slice(slashIx + 1).trim() as QuotaWindow;
  const count = Number(countStr);
  if (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) {
    throw new QuotaConfigError(
      `TENANT_QUOTAS entry '${entry}' for tenant '${tenantId}': count must be a positive integer`,
    );
  }
  const windowSeconds = WINDOW_SECONDS[windowStr];
  if (windowSeconds === undefined) {
    throw new QuotaConfigError(
      `TENANT_QUOTAS entry '${entry}' for tenant '${tenantId}': window must be one of sec, min, hour`,
    );
  }
  return { action, limit: { count, windowSeconds } };
}

/**
 * Resolve the limit for `(tenantId, action)`, falling back to the
 * tenant's `*` wildcard. Returns null when no limit applies (request
 * is unconstrained — quotas disabled or no rule matches).
 */
export function resolveLimit(
  config: ParsedQuotaConfig,
  tenantId: string,
  action: QuotaAction,
): QuotaLimit | null {
  const tenantLimits = config.byTenant.get(tenantId);
  if (!tenantLimits) return null;
  return tenantLimits[action] ?? tenantLimits['*'] ?? null;
}
