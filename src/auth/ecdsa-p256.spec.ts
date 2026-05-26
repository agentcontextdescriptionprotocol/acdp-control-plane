import { generateKeyPairSync, sign } from 'node:crypto';
import {
  publicKeyFromBase64Sec1,
  publicKeyFromSec1,
  verifyEcdsaP256,
} from './ecdsa-p256';

/** Build an SEC1-uncompressed public key buffer from a freshly-generated P-256 pair. */
function generateP256() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  // Export the public key as SPKI DER and slice off the prefix to get
  // the raw SEC1 bytes that match the wire format.
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  // SEC1-uncompressed P-256 lives at the tail of the SPKI: last 65 bytes
  // start with 0x04.
  const sec1 = spki.subarray(spki.length - 65);
  return { privateKey, sec1: Buffer.from(sec1) };
}

function signIeeeP1363(privateKey: ReturnType<typeof generateP256>['privateKey'], msg: string): string {
  return sign('sha256', Buffer.from(msg, 'utf-8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
}

describe('publicKeyFromSec1', () => {
  it('accepts a real 65-byte SEC1-uncompressed P-256 key', () => {
    const { sec1 } = generateP256();
    expect(() => publicKeyFromSec1(sec1)).not.toThrow();
  });

  it('rejects wrong-length input', () => {
    expect(() => publicKeyFromSec1(Buffer.alloc(64))).toThrow(/65 bytes/);
    expect(() => publicKeyFromSec1(Buffer.alloc(33))).toThrow(/65 bytes/);
  });

  it('rejects non-0x04 SEC1 tag (compressed form)', () => {
    const { sec1 } = generateP256();
    const bad = Buffer.from(sec1);
    bad[0] = 0x02;
    expect(() => publicKeyFromSec1(bad)).toThrow(/0x04/);
  });

  it('publicKeyFromBase64Sec1 round-trips base64', () => {
    const { sec1 } = generateP256();
    expect(() => publicKeyFromBase64Sec1(sec1.toString('base64'))).not.toThrow();
  });
});

describe('verifyEcdsaP256', () => {
  it('accepts a freshly-signed message', () => {
    const { privateKey, sec1 } = generateP256();
    const pub = publicKeyFromSec1(sec1);
    const msg = 'acdp-registry-auth:v1:nonce:did:web:alice:cp.test:1234';
    const sig = signIeeeP1363(privateKey, msg);
    expect(verifyEcdsaP256(pub, msg, sig)).toBe(true);
  });

  it('rejects tampered message', () => {
    const { privateKey, sec1 } = generateP256();
    const pub = publicKeyFromSec1(sec1);
    const sig = signIeeeP1363(privateKey, 'original');
    expect(verifyEcdsaP256(pub, 'TAMPERED', sig)).toBe(false);
  });

  it('rejects wrong-length signature (not IEEE 1363)', () => {
    const { sec1 } = generateP256();
    const pub = publicKeyFromSec1(sec1);
    // DER signatures are variable length; a 70-byte buffer fails the
    // strict 64-byte length check before we even hand to OpenSSL.
    const fakeDer = Buffer.alloc(70).toString('base64');
    expect(verifyEcdsaP256(pub, 'x', fakeDer)).toBe(false);
  });

  it('rejects signatures from a different key', () => {
    const a = generateP256();
    const b = generateP256();
    const pubA = publicKeyFromSec1(a.sec1);
    const sigB = signIeeeP1363(b.privateKey, 'msg');
    expect(verifyEcdsaP256(pubA, 'msg', sigB)).toBe(false);
  });

  it('rejects invalid base64 without throwing', () => {
    const { sec1 } = generateP256();
    const pub = publicKeyFromSec1(sec1);
    expect(verifyEcdsaP256(pub, 'x', '!!!not-base64!!!')).toBe(false);
  });
});
