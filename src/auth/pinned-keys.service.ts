/**
 * Pinned agent-key directory.
 *
 * Reads `CONTROL_PLANE_PINNED_KEYS` (comma-separated
 * `agent_did=public_key_b64` pairs) at boot. Used by the token
 * issuer to verify challenge signatures without standing up a full
 * did:web resolver.
 *
 * Mirrors the registry's `[playground] pinned_keys` config exactly so
 * an operator who maintains one list also maintains the other.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KeyObject } from 'node:crypto';
import { publicKeyFromBase64 } from './ed25519';

export interface PinnedKey {
  agentDid: string;
  publicKey: KeyObject;
  rawB64: string;
}

@Injectable()
export class PinnedKeysService implements OnModuleInit {
  private readonly logger = new Logger(PinnedKeysService.name);
  private keys: Map<string, PinnedKey> = new Map();

  onModuleInit(): void {
    const raw = process.env.CONTROL_PLANE_PINNED_KEYS ?? '';
    this.load(raw);
  }

  /** Reset and reload from a raw env-string. Exposed for tests. */
  load(raw: string): void {
    const next = new Map<string, PinnedKey>();
    if (raw.trim()) {
      for (const entry of raw.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        // Split on the FIRST `=` — base64 padding uses `=` too,
        // so lastIndexOf would mis-split on padded 44-char keys.
        const eq = trimmed.indexOf('=');
        if (eq < 0) {
          this.logger.warn(
            `Skipping malformed CONTROL_PLANE_PINNED_KEYS entry (no '='): '${trimmed}'`,
          );
          continue;
        }
        const did = trimmed.slice(0, eq).trim();
        const b64 = trimmed.slice(eq + 1).trim();
        if (!did || !b64) continue;
        try {
          const key = publicKeyFromBase64(b64);
          next.set(did, { agentDid: did, publicKey: key, rawB64: b64 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(
            `Skipping CONTROL_PLANE_PINNED_KEYS entry for '${did}': ${msg}`,
          );
        }
      }
    }
    this.keys = next;
    this.logger.log(`Loaded ${this.keys.size} pinned key(s)`);
  }

  get(agentDid: string): PinnedKey | undefined {
    return this.keys.get(agentDid);
  }

  size(): number {
    return this.keys.size;
  }
}
