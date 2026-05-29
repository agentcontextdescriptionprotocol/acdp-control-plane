/**
 * Domain packs runtime wiring (plan §1).
 *
 * Reads `DOMAIN_PACKS` (comma-separated pack names) at module init,
 * resolves each name against `KNOWN_DOMAIN_PACKS`, and registers the
 * resolved packs into a singleton `DomainPackRegistry`. Unknown names
 * fail at app construction — operators see a clear boot-time error
 * instead of silently running with fewer packs than they configured.
 *
 * Marked `@Global()` so the registry can be injected anywhere
 * (`IngestService` for context-type gating, `DomainPacksController`
 * for discovery) without each module importing `DomainPacksModule`.
 */
import { Global, Module } from '@nestjs/common';
import { DomainPackRegistry } from './domain-pack';
import { DomainPacksController } from './domain-packs.controller';
import { KNOWN_DOMAIN_PACKS } from './known-packs';

/**
 * Build a `DomainPackRegistry` from a raw `DOMAIN_PACKS` env-string.
 * Exported for unit tests and the module factory below.
 *
 * Semantics:
 * - Empty / whitespace → empty registry (backward compat: ingestion
 *   gating is a no-op until at least one pack is registered).
 * - Each name must appear in `KNOWN_DOMAIN_PACKS`; otherwise throws.
 * - Duplicate names in the env-string throw (via
 *   `DomainPackRegistry.register`).
 */
export function buildDomainPackRegistry(raw: string): DomainPackRegistry {
  const reg = new DomainPackRegistry();
  if (!raw || !raw.trim()) return reg;
  for (const name of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const pack = KNOWN_DOMAIN_PACKS[name];
    if (!pack) {
      const available = Object.keys(KNOWN_DOMAIN_PACKS).join(', ') || '(none)';
      throw new Error(
        `Unknown domain pack '${name}' in DOMAIN_PACKS. Available: ${available}`,
      );
    }
    reg.register(pack);
  }
  return reg;
}

@Global()
@Module({
  controllers: [DomainPacksController],
  providers: [
    {
      provide: DomainPackRegistry,
      useFactory: () => buildDomainPackRegistry(process.env.DOMAIN_PACKS ?? ''),
    },
  ],
  exports: [DomainPackRegistry],
})
export class DomainPacksModule {}
