/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';

import { AppConfigService } from '../config/app-config.service';
import { ChallengeStore } from './challenge-store.service';
import { IntrospectController } from './introspect.controller';
import { PinnedKeysService } from './pinned-keys.service';
import { TokenIssuer } from './token-issuer.service';

const SECRET = 'a'.repeat(64);
const ISS = 'cp.test';

function fakeConfig(): any {
  return {
    jwtSecret: SECRET,
    jwtAuthority: ISS,
    jwtTtlSeconds: 3600,
    challengeTtlSeconds: 300,
  };
}

function freshClaims(overrides: Partial<{
  jti: string;
  sub: string;
  iss: string;
  exp: number;
  keyId: string;
  registry: string;
}> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: overrides.iss ?? ISS,
    sub: overrides.sub ?? 'did:web:alice',
    jti: overrides.jti ?? 'jti-1',
    iat: now,
    exp: overrides.exp ?? now + 3600,
    acdp: {
      registry: overrides.registry ?? ISS,
      key_id: overrides.keyId ?? 'did:web:alice#key-1',
    },
  };
}

function tokenFor(claims: ReturnType<typeof freshClaims>, secret = SECRET): string {
  return jwt.sign(claims, secret, { algorithm: 'HS256', noTimestamp: true });
}

describe('IntrospectController', async () => {
  let controller: IntrospectController;

  beforeEach(async () => {
    const cfg = fakeConfig();
    const mod = await Test.createTestingModule({
      controllers: [IntrospectController],
      providers: [
        { provide: AppConfigService, useValue: cfg },
        ChallengeStore,
        PinnedKeysService,
        TokenIssuer,
      ],
    }).compile();
    controller = mod.get(IntrospectController);
  });

  it('returns active=true and full claim set for a valid token', async () => {
    const tok = tokenFor(freshClaims({ jti: 'jti-active', sub: 'did:web:alice' }));
    const res = await controller.introspect({ token: tok });
    expect(res.active).toBe(true);
    expect(res.iss).toBe(ISS);
    expect(res.sub).toBe('did:web:alice');
    expect(res.jti).toBe('jti-active');
    expect(res.key_id).toBe('did:web:alice#key-1');
    expect(res.registry).toBe(ISS);
    expect(res.token_type).toBe('Bearer');
    expect(res.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns ONLY {active: false} for a signature-invalid token (RFC 7662 §2.2)', async () => {
    // Signed with the wrong secret — verifyJwt rejects.
    const wrongSecretToken = tokenFor(freshClaims(), 'b'.repeat(64));
    const res = await controller.introspect({ token: wrongSecretToken });
    expect(res.active).toBe(false);
    // No other fields leak.
    expect(res.iss).toBeUndefined();
    expect(res.sub).toBeUndefined();
    expect(res.jti).toBeUndefined();
    expect(res.exp).toBeUndefined();
    expect(res.key_id).toBeUndefined();
  });

  it('returns active=false for a token with a wrong issuer', async () => {
    const otherIssToken = tokenFor(freshClaims({ iss: 'someone-else' }));
    const res = await controller.introspect({ token: otherIssToken });
    expect(res.active).toBe(false);
  });

  it('returns active=false for an expired token', async () => {
    const expired = tokenFor(freshClaims({ exp: Math.floor(Date.now() / 1000) - 60 }));
    const res = await controller.introspect({ token: expired });
    expect(res.active).toBe(false);
  });

  it('returns active=false for un-decodable garbage', async () => {
    const res = await controller.introspect({ token: 'not-a-jwt-at-all' });
    expect(res.active).toBe(false);
  });

  it('returns the same shape for two distinct failure modes (no oracle)', async () => {
    // Per RFC 7662 §2.2, the response for any failure must be
    // indistinguishable from any other failure.
    const wrongSig = await controller.introspect({
      token: tokenFor(freshClaims(), 'wrong-secret-xxxxxxxxxxxxxxxxxxxxxx'),
    });
    const wrongIss = await controller.introspect({
      token: tokenFor(freshClaims({ iss: 'attacker.example' })),
    });
    expect(wrongSig).toEqual(wrongIss);
    expect(wrongSig).toEqual({ active: false });
  });
});
