import {
  parseTrustedIssuers,
  TrustedIssuerError,
  TrustedIssuerRegistry,
} from './trusted-issuers';

const SHORT = 'short';
const OK_SECRET = 'a'.repeat(32);

describe('parseTrustedIssuers', () => {
  it('parses a minimal entry (iss|alg|secret)', () => {
    const out = parseTrustedIssuers(`reg-a|HS256|${OK_SECRET}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.iss).toBe('reg-a');
    expect(out[0]!.alg).toBe('HS256');
    expect(out[0]!.secret).toBe(OK_SECRET);
    expect(out[0]!.audience).toBeUndefined();
    expect(out[0]!.requiredScope).toBeUndefined();
  });

  it('parses audience + scope when present', () => {
    const out = parseTrustedIssuers(`reg-a|HS256|${OK_SECRET}|control-plane|read:restricted`);
    expect(out[0]!.audience).toBe('control-plane');
    expect(out[0]!.requiredScope).toBe('read:restricted');
  });

  it('parses multiple entries separated by commas', () => {
    const out = parseTrustedIssuers(
      `reg-a|HS256|${OK_SECRET},reg-b|HS256|${'b'.repeat(40)}`,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.iss).toBe('reg-a');
    expect(out[1]!.iss).toBe('reg-b');
  });

  it('returns an empty list for an empty value', () => {
    expect(parseTrustedIssuers('')).toEqual([]);
    expect(parseTrustedIssuers('   ')).toEqual([]);
  });

  it('rejects too-few fields', () => {
    expect(() => parseTrustedIssuers('reg-a|HS256')).toThrow(TrustedIssuerError);
  });

  it('rejects an empty required field', () => {
    expect(() => parseTrustedIssuers('|HS256|secret')).toThrow(TrustedIssuerError);
  });

  it('rejects unsupported algorithms', () => {
    expect(() => parseTrustedIssuers(`reg-a|RS256|${OK_SECRET}`)).toThrow(
      /HS256 supported/,
    );
  });

  it('rejects HS256 secret < 32 bytes', () => {
    expect(() => parseTrustedIssuers(`reg-a|HS256|${SHORT}`)).toThrow(/< 32 bytes/);
  });
});

describe('TrustedIssuerRegistry', () => {
  it('lookup by iss', () => {
    const reg = new TrustedIssuerRegistry([
      { iss: 'reg-a', alg: 'HS256', secret: OK_SECRET },
    ]);
    expect(reg.get('reg-a')?.iss).toBe('reg-a');
    expect(reg.get('reg-z')).toBeNull();
    expect(reg.size()).toBe(1);
    expect(reg.list()).toHaveLength(1);
  });

  it('rejects duplicate issuers', () => {
    expect(
      () =>
        new TrustedIssuerRegistry([
          { iss: 'reg-a', alg: 'HS256', secret: OK_SECRET },
          { iss: 'reg-a', alg: 'HS256', secret: OK_SECRET },
        ]),
    ).toThrow(/duplicate trusted issuer/);
  });
});
