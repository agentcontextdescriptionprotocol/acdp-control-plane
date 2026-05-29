import { generateKeyPairSync } from 'node:crypto';
import { PinnedKeysService, parseKeyEntry } from './pinned-keys.service';

function rawPubB64(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return Buffer.from(spki.subarray(spki.length - 32)).toString('base64');
}

describe('PinnedKeysService', () => {
  let svc: PinnedKeysService;

  beforeEach(() => {
    svc = new PinnedKeysService();
  });

  it('starts empty', () => {
    expect(svc.size()).toBe(0);
  });

  it('loads a single entry', () => {
    const b64 = rawPubB64();
    svc.load(`did:web:x:agents:alice=${b64}`);
    expect(svc.size()).toBe(1);
    const got = svc.get('did:web:x:agents:alice');
    expect(got).toBeDefined();
    expect(got?.rawB64).toBe(b64);
  });

  it('loads multiple entries', () => {
    svc.load(
      `did:web:x:agents:alice=${rawPubB64()},did:web:x:agents:bob=${rawPubB64()}`,
    );
    expect(svc.size()).toBe(2);
  });

  it('tolerates whitespace and trailing commas', () => {
    const b64 = rawPubB64();
    svc.load(`  did:web:x:agents:alice = ${b64} , ,`);
    expect(svc.size()).toBe(1);
    expect(svc.get('did:web:x:agents:alice')?.rawB64).toBe(b64);
  });

  it('skips entries missing `=`', () => {
    svc.load('did:web:bad-entry,did:web:also-bad');
    expect(svc.size()).toBe(0);
  });

  it('skips entries with invalid base64', () => {
    svc.load('did:web:x:agents:alice=!!!not-base64!!!');
    expect(svc.size()).toBe(0);
  });

  it('reload replaces previous state', () => {
    svc.load(`did:web:a=${rawPubB64()}`);
    svc.load(`did:web:b=${rawPubB64()}`);
    expect(svc.size()).toBe(1);
    expect(svc.get('did:web:a')).toBeUndefined();
  });

  it('empty env produces empty directory', () => {
    svc.load('');
    expect(svc.size()).toBe(0);
  });

  describe('validity windows (plan §2)', () => {
    // Fixed reference timestamps (unix seconds).
    const BEFORE = 1_500_000_000;
    const FROM = 1_700_000_000;
    const MID = 1_750_000_000;
    const UNTIL = 1_800_000_000;
    const AFTER = 1_900_000_000;

    const toMs = (s: number) => s * 1000;

    it('treats an in-window lookup as present', () => {
      const b64 = rawPubB64();
      svc.load(`did:web:rot=${b64}:${FROM}..${UNTIL}`);
      expect(svc.size()).toBe(1);
      expect(svc.get('did:web:rot', toMs(MID))?.rawB64).toBe(b64);
    });

    it('treats a before-window lookup as absent (caller falls through to did:web)', () => {
      svc.load(`did:web:rot=${rawPubB64()}:${FROM}..${UNTIL}`);
      expect(svc.get('did:web:rot', toMs(BEFORE))).toBeUndefined();
    });

    it('treats an after-window lookup as absent (validUntil is exclusive)', () => {
      svc.load(`did:web:rot=${rawPubB64()}:${FROM}..${UNTIL}`);
      expect(svc.get('did:web:rot', toMs(UNTIL))).toBeUndefined();
      expect(svc.get('did:web:rot', toMs(AFTER))).toBeUndefined();
    });

    it('treats exactly-at-validFrom as in-window (inclusive lower bound)', () => {
      svc.load(`did:web:rot=${rawPubB64()}:${FROM}..${UNTIL}`);
      expect(svc.get('did:web:rot', toMs(FROM))).toBeDefined();
    });

    it('accepts an open-from window (no validFrom, with validUntil)', () => {
      svc.load(`did:web:rot=${rawPubB64()}:..${UNTIL}`);
      expect(svc.get('did:web:rot', toMs(BEFORE))).toBeDefined();
      expect(svc.get('did:web:rot', toMs(UNTIL))).toBeUndefined();
    });

    it('accepts an open-until window (with validFrom, no validUntil)', () => {
      svc.load(`did:web:rot=${rawPubB64()}:${FROM}..`);
      expect(svc.get('did:web:rot', toMs(BEFORE))).toBeUndefined();
      expect(svc.get('did:web:rot', toMs(AFTER))).toBeDefined();
    });

    it('accepts algo + window in the same entry', () => {
      const b64 = rawPubB64();
      svc.load(`did:web:rot=${b64}:ed25519:${FROM}..${UNTIL}`);
      const got = svc.get('did:web:rot', toMs(MID));
      expect(got?.algorithm).toBe('ed25519');
      expect(got?.validFromSec).toBe(FROM);
      expect(got?.validUntilSec).toBe(UNTIL);
    });

    it('rejects a backwards window (validFrom >= validUntil)', () => {
      // Bad entry is skipped with a warning, not thrown — matches the
      // existing "warn-and-skip" behavior for malformed entries.
      svc.load(`did:web:rot=${rawPubB64()}:${UNTIL}..${FROM}`);
      expect(svc.size()).toBe(0);
    });

    it('rejects a degenerate ":.." window (must specify at least one bound)', () => {
      svc.load(`did:web:rot=${rawPubB64()}:..`);
      expect(svc.size()).toBe(0);
    });
  });

  describe('parseKeyEntry', () => {
    it('parses key alone (no algo, no window)', () => {
      const r = parseKeyEntry('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
      expect(r.algorithm).toBe('ed25519');
      expect(r.validFromSec).toBeUndefined();
      expect(r.validUntilSec).toBeUndefined();
    });

    it('parses key:algo', () => {
      const r = parseKeyEntry('XYZ:ecdsa-p256');
      expect(r.keyB64).toBe('XYZ');
      expect(r.algorithm).toBe('ecdsa-p256');
    });

    it('parses key:from..until (algo defaults to ed25519)', () => {
      const r = parseKeyEntry('XYZ:1700000000..1800000000');
      expect(r.keyB64).toBe('XYZ');
      expect(r.algorithm).toBe('ed25519');
      expect(r.validFromSec).toBe(1700000000);
      expect(r.validUntilSec).toBe(1800000000);
    });

    it('parses key:algo:from..until', () => {
      const r = parseKeyEntry('XYZ:ecdsa-p256:1700000000..1800000000');
      expect(r.keyB64).toBe('XYZ');
      expect(r.algorithm).toBe('ecdsa-p256');
      expect(r.validFromSec).toBe(1700000000);
      expect(r.validUntilSec).toBe(1800000000);
    });
  });
});
