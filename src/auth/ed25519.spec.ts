import { generateKeyPairSync, sign } from 'node:crypto';
import {
  publicKeyFromBase64,
  publicKeyFromRawBytes,
  verifyEd25519,
} from './ed25519';

describe('ed25519 helpers', () => {
  function freshKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    // The raw 32-byte public key lives at the end of the SPKI DER.
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    const rawPub = Buffer.from(spki.subarray(spki.length - 32));
    return { publicKey, privateKey, rawPub };
  }

  it('round-trips a real Ed25519 signature', () => {
    const { privateKey, rawPub } = freshKeyPair();
    const message = 'acdp-registry-auth:v1:nonce-a:did:web:x:r:1';
    const sig = sign(null, Buffer.from(message), privateKey).toString('base64');

    const key = publicKeyFromRawBytes(rawPub);
    expect(verifyEd25519(key, message, sig)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const { privateKey, rawPub } = freshKeyPair();
    const sig = sign(null, Buffer.from('original'), privateKey).toString('base64');
    const key = publicKeyFromRawBytes(rawPub);
    expect(verifyEd25519(key, 'TAMPERED', sig)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const { privateKey, rawPub } = freshKeyPair();
    const sig = sign(null, Buffer.from('msg'), privateKey);
    sig[0] ^= 0xff; // flip a bit
    const key = publicKeyFromRawBytes(rawPub);
    expect(verifyEd25519(key, 'msg', sig.toString('base64'))).toBe(false);
  });

  it('rejects a wrong-length signature without throwing', () => {
    const { rawPub } = freshKeyPair();
    const key = publicKeyFromRawBytes(rawPub);
    expect(verifyEd25519(key, 'msg', Buffer.from('short').toString('base64'))).toBe(
      false,
    );
  });

  it('publicKeyFromBase64 accepts a padded 44-char base64', () => {
    const { rawPub } = freshKeyPair();
    const b64 = rawPub.toString('base64');
    expect(b64.length).toBe(44);
    expect(() => publicKeyFromBase64(b64)).not.toThrow();
  });

  it('throws on wrong-length raw key', () => {
    expect(() => publicKeyFromRawBytes(Buffer.alloc(16))).toThrow(
      /must be 32 bytes/,
    );
  });
});
