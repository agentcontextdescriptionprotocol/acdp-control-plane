/**
 * Capability declaration + discovery.
 *
 * Self-declaration flow (per deferred-plan §4):
 *   1. Agent generates `declared_at = now-ish` and computes
 *      `acdp-cap:v1:<agent_did>:<capability_uri>:<declared_at>`.
 *   2. Agent Ed25519-signs that canonical string with their pinned key.
 *   3. POST to /agents/capabilities with the signature + key_id.
 *   4. Server verifies the signature against the pinned public key,
 *      pins `declared_at` server-side (rejecting any future-dated
 *      drift), and persists.
 *
 * Discovery: orchestrators query by capability_uri (`GET /agents?
 * capability=...`). V2 layers RL bandit routing (#5) on top.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyEd25519 } from '../auth/ed25519';
import { PinnedKeysService } from '../auth/pinned-keys.service';
import { capabilityAssertion, parseCapabilityUri } from './capability-uri';
import { CapabilityRepository, CapabilityRow } from './capability.repository';

const MAX_CLOCK_SKEW_SECONDS = 300;

@Injectable()
export class CapabilityService implements OnModuleInit {
  private readonly logger = new Logger(CapabilityService.name);
  /**
   * Own private PinnedKeysService instance. Decoupled from
   * `AuthModule.forRoot`'s conditional registration so capability
   * declaration works regardless of whether `TOKEN_ISSUANCE_ENABLED`
   * is on. Reads from the same `CONTROL_PLANE_PINNED_KEYS` env var,
   * so operators only maintain one list.
   */
  private readonly pinned = new PinnedKeysService();

  constructor(private readonly repo: CapabilityRepository) {}

  onModuleInit(): void {
    // OnModuleInit on the private PinnedKeysService isn't auto-invoked
    // (Nest only calls lifecycle hooks on DI-registered instances),
    // so we trigger it explicitly. Tests can swap by calling
    // `setPinnedKeys()` instead of relying on this hook.
    this.pinned.onModuleInit();
  }

  /** Visible for tests — load pinned keys from an explicit string. */
  setPinnedKeys(raw: string): void {
    this.pinned.load(raw);
  }

  /**
   * Verify + persist one capability declaration.
   *
   * `declaredAtIso` is the value the agent USED when computing the
   * signature; the server validates it's within ±300s of `now` and
   * stores that same value (so a re-fetch returns what the agent
   * signed).
   */
  async declare(req: {
    agentDid: string;
    capabilityUri: string;
    declaredAtIso: string;
    keyId: string;
    algorithm: string;
    signature: string;
  }): Promise<CapabilityRow> {
    // Schema validation (URN form + segment char set).
    parseCapabilityUri(req.capabilityUri);

    if (req.algorithm !== 'ed25519') {
      throw new BadRequestException(
        `unsupported signature algorithm: '${req.algorithm}' (only ed25519 in V1)`,
      );
    }

    // Clock-skew check on the agent-provided timestamp.
    const declaredAtMs = Date.parse(req.declaredAtIso);
    if (!Number.isFinite(declaredAtMs)) {
      throw new BadRequestException(
        `declared_at is not a valid ISO-8601 timestamp: '${req.declaredAtIso}'`,
      );
    }
    const skewSec = Math.abs(Date.now() - declaredAtMs) / 1000;
    if (skewSec > MAX_CLOCK_SKEW_SECONDS) {
      throw new BadRequestException(
        `declared_at clock skew ${skewSec.toFixed(0)}s exceeds ${MAX_CLOCK_SKEW_SECONDS}s window`,
      );
    }

    // Resolve pinned key. V2 plugs in did:web (#1) as a fallback here.
    const pinned = this.pinned.get(req.agentDid);
    if (!pinned) {
      throw new UnauthorizedException(
        `agent_did '${req.agentDid}' has no pinned public key on this control plane`,
      );
    }

    const signingInput = capabilityAssertion(
      req.agentDid,
      req.capabilityUri,
      req.declaredAtIso,
    );
    const ok = verifyEd25519(pinned.publicKey, signingInput, req.signature);
    if (!ok) {
      throw new UnauthorizedException('capability declaration signature verification failed');
    }

    const row = await this.repo.declare({
      agentDid: req.agentDid,
      capabilityUri: req.capabilityUri,
      declaredAt: req.declaredAtIso,
      signedBy: req.keyId,
      signature: req.signature,
    });

    this.logger.log(
      `capability declared: agent=${req.agentDid} cap=${req.capabilityUri} key=${req.keyId}`,
    );
    return row;
  }

  /** List an agent's declared capabilities. */
  async listForAgent(agentDid: string): Promise<CapabilityRow[]> {
    return this.repo.findByAgent(agentDid);
  }

  /** Find agents that declared a capability. */
  async findAgentsWithCapability(capabilityUri: string): Promise<CapabilityRow[]> {
    // Validate the query shape so a typo returns 400 instead of [].
    parseCapabilityUri(capabilityUri);
    return this.repo.findByCapability(capabilityUri);
  }
}
