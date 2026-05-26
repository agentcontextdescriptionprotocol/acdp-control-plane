import { DidUrlError, didWebToUrl, keyFragment, stripFragment } from './did-url';

describe('didWebToUrl', () => {
  it('bare authority maps to /.well-known/did.json', () => {
    expect(didWebToUrl('did:web:example.com')).toBe(
      'https://example.com/.well-known/did.json',
    );
  });

  it('path authority maps to /path/did.json', () => {
    expect(didWebToUrl('did:web:example.com:agents:alice')).toBe(
      'https://example.com/agents/alice/did.json',
    );
  });

  it('decodes percent-encoded colons in authority (port)', () => {
    expect(didWebToUrl('did:web:host%3A8443')).toBe(
      'https://host:8443/.well-known/did.json',
    );
  });

  it('rejects non-did:web', () => {
    expect(() => didWebToUrl('did:key:abc')).toThrow(DidUrlError);
  });

  it('rejects empty body', () => {
    expect(() => didWebToUrl('did:web:')).toThrow(DidUrlError);
  });
});

describe('keyFragment / stripFragment', () => {
  it('keyFragment returns post-# fragment', () => {
    expect(keyFragment('did:web:x:agents:alice#key-1')).toBe('key-1');
  });
  it('keyFragment is empty when no fragment', () => {
    expect(keyFragment('did:web:x:agents:alice')).toBe('');
  });
  it('stripFragment drops the fragment', () => {
    expect(stripFragment('did:web:x:agents:alice#key-1')).toBe(
      'did:web:x:agents:alice',
    );
  });
  it('stripFragment is identity when no fragment', () => {
    expect(stripFragment('did:web:x:agents:alice')).toBe(
      'did:web:x:agents:alice',
    );
  });
});
