/**
 * Agent → tenant mapping resolver.
 *
 * Wire format (TENANT_AGENTS env var):
 *
 *   tenant_id:agent_did[,tenant_id:agent_did,...]
 *
 * Example:
 *
 *   TENANT_AGENTS=tenant-a:did:web:agents.example:alice,tenant-b:did:web:agents.example:bob
 *
 * Reasoning for putting tenant *first*: the agent_did itself contains
 * `:` separators, so `did:tenant` order would force fragile escaping.
 * `tenant:did` lets us split on the first `:` and treat the rest as
 * the DID literally.
 */

import { DEFAULT_TENANT_ID } from './tenant-context';

export class TenantAgentsConfigError extends Error {}

export interface AgentTenantBinding {
  tenantId: string;
  agentDid: string;
}

/**
 * Parse the TENANT_AGENTS wire format. Returns an array of bindings.
 * Throws `TenantAgentsConfigError` on malformed entries — better to
 * fail at boot than to silently misroute a tenant's tokens.
 */
export function parseTenantAgents(raw: string): AgentTenantBinding[] {
  if (!raw.trim()) return [];
  const out: AgentTenantBinding[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':');
    if (idx <= 0 || idx === entry.length - 1) {
      throw new TenantAgentsConfigError(
        `TENANT_AGENTS entry '${entry}' must be of the form 'tenant_id:agent_did'`,
      );
    }
    const tenantId = entry.slice(0, idx);
    const agentDid = entry.slice(idx + 1);
    if (!tenantId || !agentDid) {
      throw new TenantAgentsConfigError(
        `TENANT_AGENTS entry '${entry}' has an empty field`,
      );
    }
    out.push({ tenantId, agentDid });
  }
  return out;
}

/**
 * Build a `did → tenant` lookup. Duplicate `agent_did` entries are
 * rejected (operator error: an agent can't belong to two tenants).
 */
export function buildAgentTenantLookup(
  bindings: AgentTenantBinding[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of bindings) {
    if (out.has(b.agentDid) && out.get(b.agentDid) !== b.tenantId) {
      throw new TenantAgentsConfigError(
        `agent_did '${b.agentDid}' is mapped to multiple tenants`,
      );
    }
    out.set(b.agentDid, b.tenantId);
  }
  return out;
}

/**
 * Resolve the tenant for an agent_did. Agents not listed fall back
 * to the default tenant — same convention as the API-key mapping.
 */
export function tenantForAgent(
  lookup: Map<string, string>,
  agentDid: string,
): string {
  return lookup.get(agentDid) ?? DEFAULT_TENANT_ID;
}
