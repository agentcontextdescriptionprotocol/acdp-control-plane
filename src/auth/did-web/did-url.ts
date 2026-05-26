/**
 * `did:web` ↔ HTTPS URL translation.
 *
 * Ported directly from `acdp-rs/src/did/web.rs::did_web_to_url` so the
 * registry, the SDK, and the control plane construct identical URLs
 * from the same DID. RFC-ACDP-0001 §5.11, step 3.
 *
 *   did:web:example.com                  → https://example.com/.well-known/did.json
 *   did:web:example.com:users:alice      → https://example.com/users/alice/did.json
 *   did:web:host%3A8443                  → https://host:8443/.well-known/did.json
 *
 * Notes:
 * - The authority segment is percent-decoded (so `host%3A8443` → `host:8443`)
 *   exactly per the did:web spec.
 * - Subsequent segments are NOT decoded — they become path components
 *   joined by `/`.
 */

export class DidUrlError extends Error {}

export function didWebToUrl(did: string): string {
  if (!did.startsWith('did:web:')) {
    throw new DidUrlError(`not a did:web DID: ${did}`);
  }
  const rest = did.slice('did:web:'.length);
  if (!rest) {
    throw new DidUrlError(`did:web DID has empty body: ${did}`);
  }
  const parts = rest.split(':');
  let authority: string;
  try {
    authority = decodeURIComponent(parts[0]);
  } catch (e) {
    throw new DidUrlError(`authority decode: ${e instanceof Error ? e.message : e}`);
  }
  if (!authority) {
    throw new DidUrlError(`did:web authority is empty: ${did}`);
  }
  if (parts.length === 1) {
    return `https://${authority}/.well-known/did.json`;
  }
  const path = parts.slice(1).join('/');
  return `https://${authority}/${path}/did.json`;
}

/**
 * Extract the key id (post-`#` fragment) from a verification-method DID URL.
 * Returns the empty string when no fragment is present.
 *
 *   did:web:example.com:agents:alice#key-1   → "key-1"
 *   did:web:example.com                       → ""
 */
export function keyFragment(didUrl: string): string {
  const hash = didUrl.indexOf('#');
  return hash >= 0 ? didUrl.slice(hash + 1) : '';
}

/**
 * Drop the fragment from a DID URL, leaving just the DID.
 *
 *   did:web:example.com:agents:alice#key-1   → "did:web:example.com:agents:alice"
 */
export function stripFragment(didUrl: string): string {
  const hash = didUrl.indexOf('#');
  return hash >= 0 ? didUrl.slice(0, hash) : didUrl;
}
