import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './hmac';

describe('verifyWebhookSignature', () => {
  const secret = 'super-secret-key';
  const body = Buffer.from('{"type":"context_published"}');
  const valid = createHmac('sha256', secret).update(body).digest('hex');

  it('returns true for a valid hex signature', () => {
    expect(verifyWebhookSignature(body, valid, secret)).toBe(true);
  });

  it('accepts the optional sha256= prefix', () => {
    expect(verifyWebhookSignature(body, `sha256=${valid}`, secret)).toBe(true);
  });

  it('returns false when the signature is wrong', () => {
    const wrong = createHmac('sha256', 'other').update(body).digest('hex');
    expect(verifyWebhookSignature(body, wrong, secret)).toBe(false);
  });

  it('returns false for a malformed hex signature without crashing', () => {
    expect(verifyWebhookSignature(body, 'not-hex!!', secret)).toBe(false);
  });

  it('returns false when the signature length does not match', () => {
    expect(verifyWebhookSignature(body, 'deadbeef', secret)).toBe(false);
  });

  it('returns false when no signature header is provided', () => {
    expect(verifyWebhookSignature(body, '', secret)).toBe(false);
  });

  it('skips verification (returns true) when no secret is configured', () => {
    expect(verifyWebhookSignature(body, '', '')).toBe(true);
    expect(verifyWebhookSignature(body, 'anything', '')).toBe(true);
  });

  it('is sensitive to body tampering', () => {
    const tampered = Buffer.from('{"type":"context_archived"}');
    expect(verifyWebhookSignature(tampered, valid, secret)).toBe(false);
  });
});
