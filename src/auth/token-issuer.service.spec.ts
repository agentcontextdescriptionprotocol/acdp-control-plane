/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateKeyPairSync, sign } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { ChallengeStore } from './challenge-store.service';
import { IssuanceLedgerService } from './issuance-ledger.service';
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
  let ledger: IssuanceLedgerService;
  let issuer: TokenIssuer;
  const did = 'did:web:cp.test:agents:alice';
  let priv: ReturnType<typeof generateAgent>['privateKey'];

  beforeEach(() => {
    store = new ChallengeStore();
    pinned = new PinnedKeysService();
    const cfg = fakeConfig();
    cfg.authPersistence = 'memory';
    ledger = new IssuanceLedgerService(cfg, {} as any);
    const { privateKey, rawPubB64 } = generateAgent();
    priv = privateKey;
    pinned.load(`${did}=${rawPubB64}`);
    issuer = new TokenIssuer(cfg, store, pinned, ledger);
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

  // ── ledger integration ────────────────────────────────────────────────

  it('writes a mint row to the ledger on success, carrying the signer IP', () => {
    const ch = issuer.issueChallenge(did);
    issuer.issueToken(
      {
        agentDid: did,
        keyId: 'k',
        nonce: ch.nonce,
        expiresAt: ch.expiresAt,
        algorithm: 'ed25519',
        signature: signChallenge(ch.signingInput),
      },
      { signerIp: '10.0.0.1' },
    );
    const snap = ledger.__snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].row.decision).toBe('mint');
    expect(snap[0].row.sub).toBe(did);
    expect(snap[0].row.signerIp).toBe('10.0.0.1');
    expect(snap[0].row.jti).toBeTruthy();
  });

  it('writes reject_alg when an unsupported algorithm is used', () => {
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
    const snap = ledger.__snapshot();
    expect(snap.map((s) => s.row.decision)).toContain('reject_alg');
  });

  it('writes reject_signature when the signature is forged', () => {
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
    const snap = ledger.__snapshot();
    expect(snap[snap.length - 1].row.decision).toBe('reject_signature');
  });

  it('writes reject_unpinned when the agent has no pinned key', () => {
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
    const decisions = ledger.__snapshot().map((s) => s.row.decision);
    expect(decisions).toContain('reject_unpinned');
  });

  it('keeps the hash chain intact across mixed mint + reject decisions', async () => {
    // Three rejections then one mint — the chain must still verify.
    pinned.load(''); // first 3 calls will reject_unpinned
    for (let i = 0; i < 3; i++) {
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
      ).toThrow();
    }
    // Restore pinned key for the mint.
    const { privateKey, rawPubB64 } = generateAgent();
    priv = privateKey;
    pinned.load(`${did}=${rawPubB64}`);
    const ch = issuer.issueChallenge(did);
    issuer.issueToken({
      agentDid: did,
      keyId: 'k',
      nonce: ch.nonce,
      expiresAt: ch.expiresAt,
      algorithm: 'ed25519',
      signature: signChallenge(ch.signingInput),
    });
    const v = await ledger.verifyChain();
    expect(v.ok).toBe(true);
    expect(v.total).toBe(4);
  });
});
