import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify an HMAC-SHA256 signature on a raw request body.
 *
 * Accepts either a hex-encoded signature, optionally prefixed with `sha256=`.
 * When `secret` is empty, verification is skipped (dev mode) and the function
 * returns `true`.
 */
export function verifyWebhookSignature(
  body: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  if (!secret) return true;
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const provided = signatureHeader.replace(/^sha256=/, '');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
