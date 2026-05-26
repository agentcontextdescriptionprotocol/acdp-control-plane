/**
 * Pinned agent-key directory.
 *
 * Reads `CONTROL_PLANE_PINNED_KEYS` (comma-separated
 * `agent_did=public_key_b64[:algorithm]` entries) at boot. Used by
 * the token issuer to verify challenge signatures without standing
 * up a full did:web resolver.
 *
 * Wire format:
 *
 *   did:web:alice=BASE64KEY                   # defaults to ed25519
 *   did:web:bob=BASE64KEY:ecdsa-p256
 *
 * Backward compat: an entry without `:algorithm` is treated as
 * `ed25519`, matching the V1 behavior.
 *
 * Mirrors the registry's `[playground] pinned_keys` config exactly so
 * an operator who maintains one list also maintains the other.
 *
 * Marked `@Global()` so cross-module consumers (`CapabilityService`,
 * future `DidWebResolverService` fallback) share one directory
 * instead of constructing per-module copies.
 */
import { Global, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KeyObject } from 'node:crypto';
import { publicKeyFromBase64Sec1 } from './ecdsa-p256';
import { publicKeyFromBase64 } from './ed25519';

export type PinnedAlgorithm = 'ed25519' | 'ecdsa-p256';

export interface PinnedKey {
  agentDid: string;
  algorithm: PinnedAlgorithm;
  publicKey: KeyObject;
  rawB64: string;
}

@Global()
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
        const rhs = trimmed.slice(eq + 1).trim();
        if (!did || !rhs) continue;
        const { keyB64, algorithm } = splitKeyAndAlgorithm(rhs);
        try {
          const key = decodePublicKey(keyB64, algorithm);
          next.set(did, { agentDid: did, algorithm, publicKey: key, rawB64: keyB64 });
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

const SUPPORTED_ALGS: ReadonlySet<PinnedAlgorithm> = new Set([
  'ed25519',
  'ecdsa-p256',
]);

/**
 * Parse `key[:algorithm]`. We anchor on a known algorithm suffix
 * rather than splitting on the last `:` because Ed25519 base64 keys
 * may contain a `:` is — well, they actually don't in standard
 * base64, but anchoring on the suffix is the safest interpretation
 * if future algorithm tags get more complex.
 */
function splitKeyAndAlgorithm(rhs: string): {
  keyB64: string;
  algorithm: PinnedAlgorithm;
} {
  for (const alg of SUPPORTED_ALGS) {
    const suffix = `:${alg}`;
    if (rhs.endsWith(suffix)) {
      return {
        keyB64: rhs.slice(0, rhs.length - suffix.length).trim(),
        algorithm: alg,
      };
    }
  }
  return { keyB64: rhs, algorithm: 'ed25519' };
}

function decodePublicKey(b64: string, alg: PinnedAlgorithm): KeyObject {
  switch (alg) {
    case 'ed25519':
      return publicKeyFromBase64(b64);
    case 'ecdsa-p256':
      return publicKeyFromBase64Sec1(b64);
  }
}
