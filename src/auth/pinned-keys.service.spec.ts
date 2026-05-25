import { generateKeyPairSync } from 'node:crypto';
import { PinnedKeysService } from './pinned-keys.service';

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
});
