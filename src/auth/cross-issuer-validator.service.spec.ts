/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { CrossIssuerValidator } from './cross-issuer-validator.service';
import { TrustedIssuerRegistry } from './trusted-issuers';

const LOCAL_SECRET = 'L'.repeat(64);
const PEER_SECRET = 'P'.repeat(64);
const LOCAL_ISS = 'cp.local';
const PEER_ISS = 'registry-a.peer';

function fakeConfig(): any {
  return { jwtSecret: LOCAL_SECRET, jwtAuthority: LOCAL_ISS };
}

function mint(
  iss: string,
  secret: string,
  overrides: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss,
      sub: 'did:web:alice',
      jti: 'jti-test',
      iat: now,
      nbf: now,
      exp: now + 3600,
      acdp: { registry: iss, key_id: 'k1' },
      ...overrides,
    },
    secret,
    { algorithm: 'HS256', noTimestamp: true },
  );
}

function makeValidator(opts: { peers?: ConstructorParameters<typeof TrustedIssuerRegistry>[0] } = {}) {
  const registry = new TrustedIssuerRegistry(opts.peers ?? []);
  return new CrossIssuerValidator(fakeConfig(), registry);
}

describe('CrossIssuerValidator', () => {
  it('accepts a locally-issued token (iss == self)', () => {
    const v = makeValidator();
    const tok = mint(LOCAL_ISS, LOCAL_SECRET);
    const claims = v.verify(tok);
    expect(claims.iss).toBe(LOCAL_ISS);
    expect(claims.sub).toBe('did:web:alice');
  });

  it('rejects a token with a wrong-iss + wrong-secret (unrelated peer)', () => {
    const v = makeValidator();
    const tok = mint('unknown.peer', LOCAL_SECRET);
    expect(() => v.verify(tok)).toThrow(/not trusted/);
  });

  it('accepts a peer-issued token when peer is in trusted_issuers', () => {
    const v = makeValidator({
      peers: [{ iss: PEER_ISS, alg: 'HS256', secret: PEER_SECRET }] as any,
    });
    const tok = mint(PEER_ISS, PEER_SECRET);
    const claims = v.verify(tok);
    expect(claims.iss).toBe(PEER_ISS);
  });

  it('rejects a peer-iss token signed with the wrong secret', () => {
    const v = makeValidator({
      peers: [{ iss: PEER_ISS, alg: 'HS256', secret: PEER_SECRET }] as any,
    });
    const wrong = mint(PEER_ISS, 'X'.repeat(64));
    expect(() => v.verify(wrong)).toThrow(UnauthorizedException);
  });

  it('rejects a token whose nbf is in the future', () => {
    const v = makeValidator();
    const future = Math.floor(Date.now() / 1000) + 600;
    const tok = mint(LOCAL_ISS, LOCAL_SECRET, { nbf: future, iat: future });
    expect(() => v.verify(tok)).toThrow(UnauthorizedException);
  });

  it('enforces required audience when declared on the peer', () => {
    const v = makeValidator({
      peers: [
        {
          iss: PEER_ISS,
          alg: 'HS256',
          secret: PEER_SECRET,
          audience: 'control-plane',
        },
      ] as any,
    });
    // Without aud → rejected.
    expect(() => v.verify(mint(PEER_ISS, PEER_SECRET))).toThrow(/audience mismatch/);
    // With matching aud (string) → accepted.
    const okStr = mint(PEER_ISS, PEER_SECRET, { aud: 'control-plane' });
    expect(v.verify(okStr).aud).toBe('control-plane');
    // With matching aud (array) → accepted.
    const okArr = mint(PEER_ISS, PEER_SECRET, { aud: ['x', 'control-plane'] });
    expect(v.verify(okArr).aud).toEqual(['x', 'control-plane']);
  });

  it('enforces required scope when declared on the peer', () => {
    const v = makeValidator({
      peers: [
        {
          iss: PEER_ISS,
          alg: 'HS256',
          secret: PEER_SECRET,
          requiredScope: 'publish read:restricted',
        },
      ] as any,
    });
    // Missing scope → rejected.
    expect(() => v.verify(mint(PEER_ISS, PEER_SECRET, { scp: 'publish' }))).toThrow(
      /missing required scope/,
    );
    // All scopes present → accepted.
    const ok = mint(PEER_ISS, PEER_SECRET, { scp: 'publish read:restricted other' });
    expect(v.verify(ok).scp).toContain('publish');
  });

  it('rejects garbage tokens without leaking which step failed', () => {
    const v = makeValidator();
    expect(() => v.verify('not-a-jwt')).toThrow(UnauthorizedException);
    expect(() => v.verify('a.b.c')).toThrow(UnauthorizedException);
  });

  it('rejects a token with no iss claim', () => {
    const v = makeValidator();
    // jsonwebtoken refuses to sign without iss in our shape, so build by hand:
    const tok = jwt.sign({ sub: 'x', jti: 'j', iat: 0, exp: 99999999999 }, LOCAL_SECRET);
    expect(() => v.verify(tok)).toThrow(/missing iss/);
  });

  it('cross-issuer round-trip: peer-A issues, validator with peer-A in trust accepts', () => {
    // The integration scenario the federation story is built for.
    const peerToken = mint(PEER_ISS, PEER_SECRET, { sub: 'did:web:federated:bob' });
    const v = makeValidator({
      peers: [{ iss: PEER_ISS, alg: 'HS256', secret: PEER_SECRET }] as any,
    });
    const claims = v.verify(peerToken);
    expect(claims.sub).toBe('did:web:federated:bob');
    expect(claims.iss).toBe(PEER_ISS);
  });
});
