/**
 * Capability URI parser + canonical assertion builder for the
 * self-declaration flow.
 *
 * Wire form (per deferred-plan §4): `urn:acdp:cap:<verb>:<type>:<domain>`
 *
 *   urn:acdp:cap:publish:data_snapshot:finance
 *   urn:acdp:cap:retrieve:document:legal
 *
 * The ontology is loose in V1 — a closed enum lands when three real
 * agents drive the requirements. We validate URN shape + segment
 * character set so a typo doesn't sneak through; semantic validation
 * (is `data_snapshot` a real type? is `finance` a real domain?) is
 * a follow-up.
 */

const SEGMENT_RE = /^[a-z0-9_]+$/;

export class CapabilityUriError extends Error {}

export interface CapabilityUri {
  verb: string;
  type: string;
  domain: string;
  raw: string;
}

export function parseCapabilityUri(raw: string): CapabilityUri {
  if (typeof raw !== 'string') {
    throw new CapabilityUriError('capability URI must be a string');
  }
  if (!raw.startsWith('urn:acdp:cap:')) {
    throw new CapabilityUriError(
      `capability URI must start with 'urn:acdp:cap:' (got '${raw}')`,
    );
  }
  const tail = raw.slice('urn:acdp:cap:'.length);
  const parts = tail.split(':');
  if (parts.length !== 3) {
    throw new CapabilityUriError(
      `capability URI body must have exactly 3 colon-separated segments (verb:type:domain); got ${parts.length}`,
    );
  }
  const [verb, type, domain] = parts;
  for (const [name, value] of [['verb', verb], ['type', type], ['domain', domain]] as const) {
    if (!value || !SEGMENT_RE.test(value)) {
      throw new CapabilityUriError(
        `capability URI ${name} '${value ?? ''}' must match /^[a-z0-9_]+$/`,
      );
    }
  }
  return { verb: verb!, type: type!, domain: domain!, raw };
}

/**
 * Canonical signing input — the bytes the agent must Ed25519-sign to
 * prove control of `agent_did` for the declaration.
 *
 *   acdp-cap:v1:<agent_did>:<capability_uri>:<declared_at_iso>
 *
 * `declared_at_iso` is an ISO-8601 timestamp pinned by the server at
 * record-time so the assertion can't be replayed indefinitely; the
 * client sends nothing about timing — the server stamps it.
 *
 * Including a fixed `acdp-cap:v1:` prefix prevents the signature from
 * being re-used in any other context that signs the same bytes
 * (defense against domain confusion).
 */
export function capabilityAssertion(
  agentDid: string,
  capabilityUri: string,
  declaredAtIso: string,
): string {
  return `acdp-cap:v1:${agentDid}:${capabilityUri}:${declaredAtIso}`;
}
