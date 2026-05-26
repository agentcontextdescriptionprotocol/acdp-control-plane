/**
 * ECDSA-P256 helpers — parity with `acdp-rs/src/crypto/verify.rs::verify_ecdsa_p256`
 * and the registry-side `enforce_pinned_signature` from deferred-plan §10.
 *
 * Wire format (ACDP signature-algorithms registry, `ecdsa-p256`):
 *   - public key: SEC1 uncompressed, 65 bytes = `0x04 || X(32) || Y(32)`, base64.
 *   - signature: IEEE 1363 = `r(32) || s(32)`, 64 bytes, base64.
 *   NOT DER-encoded; explicitly disallowed by the protocol.
 *
 * Node's `crypto.verify` supports both wire forms via `dsaEncoding`;
 * we hard-code `ieee-p1363` to match the protocol shape.
 */
import { createPublicKey, KeyObject, verify } from 'node:crypto';

/**
 * SPKI envelope for SEC1 uncompressed P-256 public keys:
 *
 *   SEQUENCE {
 *     SEQUENCE { OID id-ecPublicKey   OID secp256r1 }
 *     BIT STRING { 0 .. 65 raw SEC1 bytes }
 *   }
 *
 * Prepending this to the 65 raw bytes produces a DER blob Node's
 * `createPublicKey` accepts.
 */
const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);

/** Wrap a raw 65-byte SEC1-uncompressed P-256 public key as a `KeyObject`. */
export function publicKeyFromSec1(sec1: Buffer): KeyObject {
  if (sec1.length !== 65) {
    throw new Error(
      `P-256 SEC1 public key must be 65 bytes (uncompressed), got ${sec1.length}`,
    );
  }
  if (sec1[0] !== 0x04) {
    throw new Error(
      `P-256 SEC1 public key must start with 0x04 (uncompressed tag); got 0x${sec1[0]!.toString(16)}`,
    );
  }
  const der = Buffer.concat([P256_SPKI_PREFIX, sec1]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/** Decode a base64 SEC1-uncompressed P-256 public key and wrap it. */
export function publicKeyFromBase64Sec1(b64: string): KeyObject {
  return publicKeyFromSec1(Buffer.from(b64, 'base64'));
}

/**
 * Verify an ECDSA-P256 signature over the ASCII bytes of `message`.
 *
 * `signatureB64` MUST be base64 of the 64-byte IEEE 1363 `r||s` wire
 * form. DER-encoded signatures are NOT accepted (the protocol forbids
 * them; allowing both is a malleability vector).
 */
export function verifyEcdsaP256(
  publicKey: KeyObject,
  message: string,
  signatureB64: string,
): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64, 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return verify(
      'sha256',
      Buffer.from(message, 'utf-8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      sig,
    );
  } catch {
    return false;
  }
}
