/**
 * DID document shape (W3C DID Core 1.0, JSON form) — only the fields
 * the resolver consults. Unknown fields are preserved during parse
 * but never read.
 *
 * https://www.w3.org/TR/did-core/#did-document-properties
 */

export interface VerificationMethod {
  /** Full DID URL, e.g. `did:web:example.com:agents:alice#key-1`. */
  id: string;
  /** DID of the controlling identity. */
  controller: string;
  /**
   * Key-encoding type. We support `Ed25519VerificationKey2020` and
   * `JsonWebKey2020`. The legacy `Ed25519VerificationKey2018` is
   * intentionally NOT supported — its base58 encoding differs from
   * the 2020 form, and accepting both invites confusion bugs.
   */
  type: 'Ed25519VerificationKey2020' | 'JsonWebKey2020';
  /** Multibase-encoded public key (only with `Ed25519VerificationKey2020`). */
  publicKeyMultibase?: string;
  /** JWK (only with `JsonWebKey2020`). */
  publicKeyJwk?: {
    kty?: string;
    crv?: string;
    x?: string;
    y?: string;
    alg?: string;
  };
}

export interface DidDocument {
  /** Per spec, MAY be a string or an array of strings. */
  '@context'?: string | string[];
  /** The DID this document describes. MUST equal the requested DID. */
  id: string;
  /** Verification methods declared by this DID. */
  verificationMethod?: VerificationMethod[];
  /**
   * DID URLs (or inline VerificationMethods) authorized for "assertion"
   * purposes — i.e. signing. We REQUIRE the verification method's id to
   * appear here; a key declared in `verificationMethod` but absent from
   * `assertionMethod` is NOT usable for proving challenges.
   */
  assertionMethod?: Array<string | VerificationMethod>;
}

/**
 * Extracted public key in the canonical raw-bytes form the rest of
 * the auth stack already speaks (base64, like PinnedKeysService).
 */
export interface ResolvedKey {
  /** Verification method id (full DID URL with fragment). */
  keyId: string;
  /** `ed25519` or `ecdsa-p256`. */
  algorithm: 'ed25519' | 'ecdsa-p256';
  /**
   * Standard-base64 raw key bytes:
   *   - ed25519:    32 bytes
   *   - ecdsa-p256: 65-byte SEC1 uncompressed (`0x04 || X || Y`)
   */
  publicKeyB64: string;
}
