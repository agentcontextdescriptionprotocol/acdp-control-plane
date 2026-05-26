/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateKeyPairSync, sign } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { ChallengeStore } from './challenge-store.service';
import { InMemoryChallengeRepository } from './in-memory-challenge.repository';
import { InMemoryRevocationRepository } from './in-memory-revocation.repository';
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
  let revocations: InMemoryRevocationRepository;
  let issuer: TokenIssuer;
  const did = 'did:web:cp.test:agents:alice';
  let priv: ReturnType<typeof generateAgent>['privateKey'];

  beforeEach(() => {
    store = new ChallengeStore(new InMemoryChallengeRepository());
    pinned = new PinnedKeysService();
    revocations = new InMemoryRevocationRepository();
    const { privateKey, rawPubB64 } = generateAgent();
    priv = privateKey;
    pinned.load(`${did}=${rawPubB64}`);
    issuer = new TokenIssuer(fakeConfig(), store, pinned, revocations);
  });

  function signChallenge(signingInput: string): string {
    return sign(null, Buffer.from(signingInput), priv).toString('base64');
  }

  it('issues a JWT for a correctly-signed challenge', async () => {
    const ch = await issuer.issueChallenge(did);
    const out = await issuer.issueToken({
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

  it('rejects an unsupported algorithm', async () => {
    const ch = await issuer.issueChallenge(did);
    await expect(
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ecdsa-p256',
        signature: signChallenge(ch.signingInput),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown nonce', async () => {
    await expect(
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: 'never-issued',
        expiresAt: 0,
        algorithm: 'ed25519',
        signature: 'ZmFrZQ==',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects reuse of the same nonce (replay defense)', async () => {
    const ch = await issuer.issueChallenge(did);
    await issuer.issueToken({
      agentDid: did,
      keyId: 'k',
      nonce: ch.nonce,
      expiresAt: ch.expiresAt,
      algorithm: 'ed25519',
      signature: signChallenge(ch.signingInput),
    });
    await expect(
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token request whose agent_id mismatches the challenge owner', async () => {
    const ch = await issuer.issueChallenge(did);
    await expect(
      issuer.issueToken({
        agentDid: 'did:web:other',
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unpinned agent_did', async () => {
    pinned.load('');
    const ch = await issuer.issueChallenge(did);
    await expect(
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a bad signature', async () => {
    const ch = await issuer.issueChallenge(did);
    await expect(
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge('TAMPERED-INPUT'),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('verifyJwt accepts a token it issued', async () => {
    const ch = await issuer.issueChallenge(did);
    const out = await issuer.issueToken({
      agentDid: did,
      keyId: 'k',
      nonce: ch.nonce,
      expiresAt: ch.expiresAt,
      algorithm: 'ed25519',
      signature: signChallenge(ch.signingInput),
    });
    const claims = await issuer.verifyJwt(out.token);
    expect(claims.sub).toBe(did);
  });

  it('verifyJwt rejects a token with a wrong issuer', async () => {
    const otherToken = jwt.sign(
      { iss: 'someone-else', sub: did, jti: 'x', iat: 0, exp: 99999999999 },
      fakeConfig().jwtSecret,
      { algorithm: 'HS256' },
    );
    await expect(issuer.verifyJwt(otherToken)).rejects.toThrow(UnauthorizedException);
  });

  it('verifyJwt rejects a revoked token even if not yet expired', async () => {
    const ch = await issuer.issueChallenge(did);
    const out = await issuer.issueToken({
      agentDid: did,
      keyId: 'k',
      nonce: ch.nonce,
      expiresAt: ch.expiresAt,
      algorithm: 'ed25519',
      signature: signChallenge(ch.signingInput),
    });
    const claims = await issuer.verifyJwt(out.token);

    await revocations.revoke({
      jti: claims.jti,
      sub: claims.sub,
      iss: claims.iss,
      exp: claims.exp,
      revokedBy: 'unit-test',
      reason: 'admin_revoke',
    });

    await expect(issuer.verifyJwt(out.token)).rejects.toThrow(/revoked/);
  });

  it('issueToken is single-use even under concurrent requests (in-memory map race-window)', async () => {
    const ch = await issuer.issueChallenge(did);
    const both = await Promise.allSettled([
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
      issuer.issueToken({
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      }),
    ]);
    const fulfilled = both.filter((r) => r.status === 'fulfilled');
    const rejected = both.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
