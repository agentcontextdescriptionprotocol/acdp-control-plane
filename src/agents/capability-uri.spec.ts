import {
  CapabilityUriError,
  capabilityAssertion,
  parseCapabilityUri,
} from './capability-uri';

describe('parseCapabilityUri', () => {
  it('parses a valid URN', () => {
    const u = parseCapabilityUri('urn:acdp:cap:publish:data_snapshot:finance');
    expect(u.verb).toBe('publish');
    expect(u.type).toBe('data_snapshot');
    expect(u.domain).toBe('finance');
  });

  it('rejects non-urn prefix', () => {
    expect(() => parseCapabilityUri('cap:publish:x:y')).toThrow(CapabilityUriError);
  });

  it('rejects too-few segments', () => {
    expect(() => parseCapabilityUri('urn:acdp:cap:publish:onlytwo')).toThrow(
      /exactly 3 colon-separated/,
    );
  });

  it('rejects too-many segments', () => {
    expect(() => parseCapabilityUri('urn:acdp:cap:a:b:c:d')).toThrow(
      /exactly 3 colon-separated/,
    );
  });

  it('rejects empty segments', () => {
    expect(() => parseCapabilityUri('urn:acdp:cap:::')).toThrow(/match/);
  });

  it('rejects uppercase / hyphen / dot in segments', () => {
    expect(() => parseCapabilityUri('urn:acdp:cap:Publish:type:domain')).toThrow();
    expect(() => parseCapabilityUri('urn:acdp:cap:publish:my-type:domain')).toThrow();
    expect(() => parseCapabilityUri('urn:acdp:cap:publish:type:my.domain')).toThrow();
  });

  it('accepts underscores and digits', () => {
    expect(() => parseCapabilityUri('urn:acdp:cap:publish_v2:data_snapshot:finance_2024')).not.toThrow();
  });
});

describe('capabilityAssertion', () => {
  it('produces the pinned canonical form', () => {
    expect(
      capabilityAssertion(
        'did:web:cp:agents:alice',
        'urn:acdp:cap:publish:data_snapshot:finance',
        '2026-05-25T18:00:00Z',
      ),
    ).toBe(
      'acdp-cap:v1:did:web:cp:agents:alice:urn:acdp:cap:publish:data_snapshot:finance:2026-05-25T18:00:00Z',
    );
  });
});
