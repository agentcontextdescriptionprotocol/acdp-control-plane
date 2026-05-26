import { JwksClient } from './jwks-client';
import { buildSigningMaterial, generateEd25519Pem } from './jwt-signing';

function makeJwks(): { jwk: Record<string, string>; pemPublic: string; kid: string } {
  const { privatePem, publicPem } = generateEd25519Pem();
  const m = buildSigningMaterial({ algorithm: 'EdDSA', privateKeyPem: privatePem });
  return {
    jwk: m.publicJwk as unknown as Record<string, string>,
    pemPublic: publicPem,
    kid: m.kid,
  };
}

function mockFetch(body: unknown, opts: { status?: number } = {}) {
  return jest.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: opts.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('JwksClient', () => {
  it('fetches and returns the matching key by kid', async () => {
    const { jwk, kid } = makeJwks();
    const fetcher = mockFetch({ keys: [jwk] });
    const client = new JwksClient('https://peer/jwks', fetcher);
    const pem = await client.getSigningKey(kid);
    expect(pem).toMatch(/BEGIN PUBLIC KEY/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first key when kid does not match', async () => {
    const { jwk } = makeJwks();
    const fetcher = mockFetch({ keys: [jwk] });
    const client = new JwksClient('https://peer/jwks', fetcher);
    const pem = await client.getSigningKey('nonexistent-kid');
    expect(pem).toMatch(/BEGIN PUBLIC KEY/);
  });

  it('falls back to the first key when token has no kid', async () => {
    const { jwk } = makeJwks();
    const fetcher = mockFetch({ keys: [jwk] });
    const client = new JwksClient('https://peer/jwks', fetcher);
    const pem = await client.getSigningKey(null);
    expect(pem).toMatch(/BEGIN PUBLIC KEY/);
  });

  it('caches the JWKS for 5 minutes', async () => {
    const { jwk, kid } = makeJwks();
    const fetcher = mockFetch({ keys: [jwk] });
    let now = 1_000_000;
    const client = new JwksClient('https://peer/jwks', fetcher, () => now);
    await client.getSigningKey(kid);
    await client.getSigningKey(kid);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 4 * 60 * 1000; // 4 min
    await client.getSigningKey(kid);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 2 * 60 * 1000; // 6 min total
    await client.getSigningKey(kid);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('throws when JWKS returns HTTP error, and caches the failure briefly', async () => {
    let calls = 0;
    const fetcher = jest.fn(async () => {
      calls++;
      return new Response('server down', { status: 503 });
    }) as unknown as typeof fetch;
    let now = 1_000_000;
    const client = new JwksClient('https://peer/jwks', fetcher, () => now);
    await expect(client.getSigningKey(null)).rejects.toThrow(/HTTP 503/);
    await expect(client.getSigningKey(null)).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(1); // second call hit the error cache
    now += 31_000; // past 30s error TTL
    await expect(client.getSigningKey(null)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('skips malformed JWK entries (mixed-shape JWKS is tolerated)', async () => {
    const { jwk, kid } = makeJwks();
    const fetcher = mockFetch({
      keys: [
        { kty: 'RSA', kid: 'wrong-type' }, // skipped
        jwk,
      ],
    });
    const client = new JwksClient('https://peer/jwks', fetcher);
    const pem = await client.getSigningKey(kid);
    expect(pem).toMatch(/BEGIN PUBLIC KEY/);
  });

  it('throws when JWKS payload is malformed', async () => {
    const fetcher = mockFetch('not json at all');
    const client = new JwksClient('https://peer/jwks', fetcher);
    await expect(client.getSigningKey(null)).rejects.toThrow();
  });

  it('throws when no usable keys', async () => {
    const fetcher = mockFetch({ keys: [{ kty: 'RSA' }] });
    const client = new JwksClient('https://peer/jwks', fetcher);
    await expect(client.getSigningKey(null)).rejects.toThrow(/no usable keys/);
  });

  it('coalesces concurrent misses into one fetch (thundering-herd defense)', async () => {
    const { jwk, kid } = makeJwks();
    let calls = 0;
    const fetcher = jest.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new JwksClient('https://peer/jwks', fetcher);
    await Promise.all([
      client.getSigningKey(kid),
      client.getSigningKey(kid),
      client.getSigningKey(kid),
    ]);
    expect(calls).toBe(1);
  });
});
