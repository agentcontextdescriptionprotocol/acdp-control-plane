/**
 * Tenant-context type + extraction helpers.
 *
 * The tenant boundary is the unit of data isolation: rows tagged
 * `tenant_id = 'tenant-A'` MUST NOT be readable by a request that
 * carries `tenant_id = 'tenant-B'`. Repositories enforce this at the
 * `WHERE` clause; the `AuthGuard` pulls the tenant out of the API key
 * / JWT and pins it on `request.tenantId`.
 *
 * V1 single-tenant deployments use the literal `'default'` tenant
 * id. The migration backfills every existing row to `'default'` so
 * the upgrade is a no-op for callers that don't opt into tenancy
 * (no \`TENANT_API_KEYS\` env, no tenant claim in their JWT).
 */

/** Reserved tenant id for single-tenant deployments. */
export const DEFAULT_TENANT_ID = 'default';

export interface TenantContext {
  tenantId: string;
}

/**
 * Allow-listed tenant API keys. Wire format documented on
 * `AppConfigService.tenantApiKeys`.
 *
 *   TENANT_API_KEYS=tenant-A:key1,tenant-A:key2,tenant-B:key3
 *
 * A bare `key4` (no `tenant:` prefix) binds to the `default` tenant.
 */
export interface TenantApiKey {
  tenantId: string;
  apiKey: string;
}

export function parseTenantApiKeys(raw: string): TenantApiKey[] {
  if (!raw) return [];
  const out: TenantApiKey[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const colon = entry.indexOf(':');
    if (colon < 0) {
      out.push({ tenantId: DEFAULT_TENANT_ID, apiKey: entry });
      continue;
    }
    const tenantId = entry.slice(0, colon).trim();
    const apiKey = entry.slice(colon + 1).trim();
    if (!tenantId || !apiKey) {
      throw new Error(`TENANT_API_KEYS entry '${entry}' has an empty side`);
    }
    out.push({ tenantId, apiKey });
  }
  return out;
}

/**
 * Build a lookup `apiKey → tenantId` from the parsed entries.
 * Duplicate keys assigned to different tenants are a config error
 * (would be a privilege-escalation vector).
 */
export function buildTenantLookup(entries: TenantApiKey[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) {
    const existing = out.get(e.apiKey);
    if (existing && existing !== e.tenantId) {
      throw new Error(
        `TENANT_API_KEYS: API key assigned to multiple tenants ('${existing}' and '${e.tenantId}')`,
      );
    }
    out.set(e.apiKey, e.tenantId);
  }
  return out;
}
