/**
 * Ed25519 helpers built on Node's built-in `crypto` module.
 *
 * The protocol exchanges raw 32-byte public keys (base64-encoded), but
 * Node's KeyObject for Ed25519 needs the SPKI DER envelope. We wrap
 * the raw bytes once at boundary; everything inside the service deals
 * in `KeyObject`s.
 */
import { createPublicKey, KeyObject, verify } from 'node:crypto';

/**
 * The 12-byte SPKI prefix for an Ed25519 OID + bitstring header.
 *
 *   SEQUENCE { SEQUENCE { OID 1.3.101.112 } BIT STRING { 0 .. } }
 *
 * Prepending this to the raw 32-byte public key produces a valid
 * SPKI-encoded Ed25519 key Node's `createPublicKey` accepts.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Wrap a raw 32-byte Ed25519 public key as a Node `KeyObject`. */
export function publicKeyFromRawBytes(raw: Buffer): KeyObject {
  if (raw.length !== 32) {
    throw new Error(
      `Ed25519 public key must be 32 bytes, got ${raw.length}`,
    );
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * Decode a base64-encoded raw 32-byte Ed25519 public key and wrap it.
 *
 * Accepts standard base64 (padded), matching the format
 * `AcdpProducer.public_key_b64` returns.
 */
export function publicKeyFromBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  return publicKeyFromRawBytes(raw);
}

/**
 * Verify an Ed25519 signature.
 *
 * @param key      Public key as a `KeyObject` (see above helpers).
 * @param message  The UTF-8 bytes that were signed.
 * @param sigB64   Base64-encoded 64-byte signature (88 chars padded).
 * @returns `true` on a valid signature, `false` otherwise. Never throws.
 */
export function verifyEd25519(
  key: KeyObject,
  message: string | Buffer,
  sigB64: string,
): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(sigB64, 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  const msg = typeof message === 'string' ? Buffer.from(message, 'utf-8') : message;
  // Ed25519 in Node: `algorithm` argument MUST be `null` (PureEdDSA).
  try {
    return verify(null, msg, key, sig);
  } catch {
    return false;
  }
}
