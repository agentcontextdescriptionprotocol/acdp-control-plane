/**
 * Domain pack contract (#7) — pluggable bundles of agent templates,
 * context types, policy rules, and search vocabularies for a vertical.
 *
 * The deferred plan flags this as the lowest-priority item ("no clear
 * customer in V1, build when a vertical-specific deployment asks").
 * This module ships the contract + a reference `finance` pack so the
 * registry / loader surface is in place; the rich-vertical packs land
 * once real customers drive the requirements.
 *
 * Why ship scaffolding now: each downstream feature (bandit routing,
 * policy engine, capability registry) has hooks where a pack can
 * inject vertical-specific behavior. Defining the contract early lets
 * those hooks be wired without a breaking change when the first real
 * pack arrives.
 */

import { PolicyDecider } from '../policy/policy-decider';

export interface AgentTemplate {
  /** Stable identifier referenced by orchestrators. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Capability URIs the agent template declares (per #4). */
  capabilities: ReadonlyArray<string>;
}

export interface ContextTypeRule {
  /** Context-type identifier (snake_case). */
  contextType: string;
  /** Required metadata fields beyond the protocol baseline. */
  requiredFields: ReadonlyArray<string>;
  /** Suggested default visibility for this type. */
  defaultVisibility: 'public' | 'restricted' | 'private';
}

export interface SearchVocab {
  /** Domain-specific keyword → canonical-term map. Drives search rewrites. */
  synonyms: Readonly<Record<string, string>>;
  /** Stop-words to drop before indexing/querying. */
  stopWords: ReadonlyArray<string>;
}

export interface DomainPack {
  /** Stable identifier — matches the directory name when packs are file-loaded. */
  id: string;
  /** Semver of the pack. */
  version: string;
  /** Human-readable label. */
  label: string;
  /** Agent templates the pack contributes. */
  agentTemplates: ReadonlyArray<AgentTemplate>;
  /** Context-type rules the pack contributes. */
  contextTypes: ReadonlyArray<ContextTypeRule>;
  /** Domain search vocab. */
  searchVocab: SearchVocab;
  /**
   * Optional policy decider the pack ships. When present, composes
   * with the global decider (caller decides order — typically
   * pack-first deny, global-second allow).
   */
  policyDecider?: PolicyDecider;
}

/**
 * In-process registry. V1 holds packs in memory keyed by id. V2
 * (when packs are actually loaded from disk) wraps a filesystem
 * walker that scans a `packs/` directory.
 */
export class DomainPackRegistry {
  private readonly byId = new Map<string, DomainPack>();

  register(pack: DomainPack): void {
    if (this.byId.has(pack.id)) {
      throw new Error(`domain pack '${pack.id}' is already registered`);
    }
    this.byId.set(pack.id, pack);
  }

  get(id: string): DomainPack | undefined {
    return this.byId.get(id);
  }

  list(): ReadonlyArray<DomainPack> {
    return Array.from(this.byId.values());
  }

  /** Aggregate every pack's agent templates (e.g. for /agents/templates). */
  allTemplates(): ReadonlyArray<{ packId: string; template: AgentTemplate }> {
    const out: { packId: string; template: AgentTemplate }[] = [];
    for (const pack of this.byId.values()) {
      for (const template of pack.agentTemplates) {
        out.push({ packId: pack.id, template });
      }
    }
    return out;
  }

  /** Find templates that contribute the given capability URI. */
  findTemplatesWithCapability(
    capabilityUri: string,
  ): ReadonlyArray<{ packId: string; template: AgentTemplate }> {
    return this.allTemplates().filter(({ template }) =>
      template.capabilities.includes(capabilityUri),
    );
  }
}
