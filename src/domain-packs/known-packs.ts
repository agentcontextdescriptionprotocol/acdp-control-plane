/**
 * In-binary catalog of domain packs the control plane ships with.
 *
 * Keyed by the name used in the `DOMAIN_PACKS` env var. Adding a new
 * pack means writing the constant (mirror `finance.pack.ts`), then
 * registering it here. Boot-time `DomainPacksModule` cross-references
 * each requested name against this map; unknown names fail at app
 * construction rather than silently dropping (see plan §1).
 */
import { DomainPack } from './domain-pack';
import { FINANCE_PACK } from './finance.pack';

export const KNOWN_DOMAIN_PACKS: Readonly<Record<string, DomainPack>> = {
  finance: FINANCE_PACK,
};
