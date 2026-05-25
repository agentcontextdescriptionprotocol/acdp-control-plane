/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateKeyPairSync, sign } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { ChallengeStore } from './challenge-store.service';
import { PinnedKeysService } from './pinned-keys.service';
import { TokenIssuer, AcdpBearerClaims } from './token-issuer.service';

function fakeConfig(): any {
  return {
    jwtSecret: 'a'.repeat(64),
    jwtAuthority: 'cp.test',
    jwtTtlSeconds: 3600,
    challengeTtlSeconds: 300,
  };
}

function generateAgent() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const rawPubB64 = Buffer.from(spki.subarray(spki.length - 32)).toString(
    'base64',
  );
  return { privateKey, rawPubB64 };
}

describe('TokenIssuer', () => {
  let store: ChallengeStore;
  let pinned: PinnedKeysService;
  let issuer: TokenIssuer;
  const did = 'did:web:cp.test:agents:alice';
  let priv: ReturnType<typeof generateAgent>['privateKey'];

  beforeEach(() => {
    store = new ChallengeStore();
    pinned = new PinnedKeysService();
    const { privateKey, rawPubB64 } = generateAgent();
    priv = privateKey;
    pinned.load(`${did}=${rawPubB64}`);
    issuer = new TokenIssuer(fakeConfig(), store, pinned);
  });

  function signChallenge(signingInput: string): string {
    return sign(null, Buffer.from(signingInput), priv).toString('base64');
  }

  it('issues a JWT for a correctly-signed challenge', () => {
    const ch = issuer.issueChallenge(did);
    const out = issuer.issueToken({
      agentDid: did,
      keyId: `${did}#key-1`,
      nonce: ch.nonce,
      expiresAt: ch.expiresAt,
      algorithm: 'ed25519',
      signature: signChallenge(ch.signingInput),
    });
    expect(out.tokenType).toBe('Bearer');
    expect(out.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const decoded = jwt.verify(out.token, fakeConfig().jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'cp.test',
    }) as AcdpBearerClaims;
    expect(decoded.sub).toBe(did);
    expect(decoded.acdp.registry).toBe('cp.test');
    expect(decoded.acdp.key_id).toBe(`${did}#key-1`);
    expect(decoded.jti).toBeTruthy();
  });

  it('rejects an unsupported algorithm', () => {
    const ch = issuer.issueChallenge(did);
    expect(() =>
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ecdsa-p256',
        signature: signChallenge(ch.signingInput),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an unknown nonce', () => {
    expect(() =>
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: 'never-issued',
        expiresAt: 0,
        algorithm: 'ed25519',
        signature: 'ZmFrZQ==',
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects reuse of the same nonce (replay defense)', () => {
    const ch = issuer.issueChallenge(did);
    issuer.issueToken({
      agentDid: did,
      keyId: 'k',
      nonce: ch.nonce,
      expiresAt: ch.expiresAt,
      algorithm: 'ed25519',
      signature: signChallenge(ch.signingInput),
    });
    expect(() =>
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a token request whose agent_id mismatches the challenge owner', () => {
    const ch = issuer.issueChallenge(did);
    expect(() =>
      issuer.issueToken({
        agentDid: 'did:web:other',
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an unpinned agent_did', () => {
    pinned.load('');
    const ch = issuer.issueChallenge(did);
    expect(() =>
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a bad signature', () => {
    const ch = issuer.issueChallenge(did);
    expect(() =>
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge('TAMPERED-INPUT'),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('verifyJwt accepts a token it issued', () => {
    const ch = issuer.issueChallenge(did);
    const out = issuer.issueToken({
      agentDid: did,
      keyId: 'k',
      nonce: ch.nonce,
      expiresAt: ch.expiresAt,
      algorithm: 'ed25519',
      signature: signChallenge(ch.signingInput),
    });
    const claims = issuer.verifyJwt(out.token);
    expect(claims.sub).toBe(did);
  });

  it('verifyJwt rejects a token with a wrong issuer', () => {
    const otherToken = jwt.sign(
      { iss: 'someone-else', sub: did, jti: 'x', iat: 0, exp: 99999999999 },
      fakeConfig().jwtSecret,
      { algorithm: 'HS256' },
    );
    expect(() => issuer.verifyJwt(otherToken)).toThrow(UnauthorizedException);
  });
});
