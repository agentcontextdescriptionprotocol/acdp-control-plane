import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { EventProcessorService } from '../processor/event-processor.service';
import { extractAuthorityFromCtxId, IngestService } from './ingest.service';

describe('IngestService', () => {
  const secret = 'svc-test-secret';
  const validPayload = {
    type: 'context_published',
    agent_id: 'did:web:a.example',
    registry_authority: 'reg.example',
    created_at: '2026-01-01T00:00:00Z',
  };

  let processor: { process: jest.Mock };
  let config: Partial<AppConfigService>;
  let service: IngestService;

  function sign(body: Buffer): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  beforeEach(() => {
    processor = { process: jest.fn().mockResolvedValue(undefined) };
    config = { webhookSecret: secret } as Partial<AppConfigService>;
    service = new IngestService(
      config as AppConfigService,
      processor as unknown as EventProcessorService,
    );
  });

  it('verifies HMAC, parses JSON, and delegates to the processor', async () => {
    const body = Buffer.from(JSON.stringify(validPayload));
    await service.handle(body, sign(body), 'run-123');

    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'context_published' }),
      'run-123',
      'default',
    );
  });

  it('prefers X-Run-Id header over payload.run_id when both are present', async () => {
    const withEmbedded = { ...validPayload, run_id: 'payload-run' };
    const body = Buffer.from(JSON.stringify(withEmbedded));
    await service.handle(body, sign(body), 'header-run');
    expect(processor.process).toHaveBeenCalledWith(
      expect.any(Object),
      'header-run',
      'default',
    );
  });

  it('falls back to payload.run_id when no header is provided', async () => {
    const withEmbedded = { ...validPayload, run_id: 'payload-run' };
    const body = Buffer.from(JSON.stringify(withEmbedded));
    await service.handle(body, sign(body), undefined);
    expect(processor.process).toHaveBeenCalledWith(
      expect.any(Object),
      'payload-run',
      'default',
    );
  });

  it('throws Unauthorized on bad signature', async () => {
    const body = Buffer.from(JSON.stringify(validPayload));
    await expect(service.handle(body, 'sha256=deadbeef', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('throws BadRequest on invalid JSON', async () => {
    const body = Buffer.from('not json');
    await expect(service.handle(body, sign(body), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequest when required fields are missing', async () => {
    const body = Buffer.from(JSON.stringify({ type: 'x' }));
    await expect(service.handle(body, sign(body), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequest on a non-object payload', async () => {
    const body = Buffer.from('null');
    await expect(service.handle(body, sign(body), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('skips HMAC verification when webhookSecret is empty (dev mode)', async () => {
    // AppConfigService fields are readonly, so re-instantiate instead of mutating.
    const emptySecretConfig = { webhookSecret: '' } as Partial<AppConfigService>;
    service = new IngestService(
      emptySecretConfig as AppConfigService,
      processor as unknown as EventProcessorService,
    );
    const body = Buffer.from(JSON.stringify(validPayload));
    await service.handle(body, '', undefined);
    expect(processor.process).toHaveBeenCalledTimes(1);
  });

  it('extracts registry_authority from ctx_id when the payload omits it', async () => {
    // Mirrors what an actual ACDP registry WebhookEvent looks like: no
    // explicit `registry_authority`, but `ctx_id` is `acdp://<authority>/<id>`.
    const payload = {
      type: 'context_published',
      agent_id: 'did:web:a.example',
      ctx_id: 'acdp://registry-a.playground.local/01H3X4Y5',
      created_at: '2026-01-01T00:00:00Z',
    };
    const body = Buffer.from(JSON.stringify(payload));
    await service.handle(body, sign(body), undefined);

    expect(processor.process).toHaveBeenCalledTimes(1);
    const [forwarded] = processor.process.mock.calls[0];
    expect(forwarded.registry_authority).toBe('registry-a.playground.local');
  });

  it('throws BadRequest when both registry_authority and ctx_id authority are missing', async () => {
    const payload = {
      type: 'context_published',
      agent_id: 'did:web:a.example',
      // no ctx_id, no registry_authority
    };
    const body = Buffer.from(JSON.stringify(payload));
    await expect(service.handle(body, sign(body), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('extractAuthorityFromCtxId', () => {
  it('returns the authority for a well-formed acdp:// ctx_id', () => {
    expect(extractAuthorityFromCtxId('acdp://registry-a.example/01ABC')).toBe(
      'registry-a.example',
    );
  });
  it('returns undefined for non-acdp URIs', () => {
    expect(extractAuthorityFromCtxId('https://example.com/x')).toBeUndefined();
    expect(extractAuthorityFromCtxId('')).toBeUndefined();
    expect(extractAuthorityFromCtxId(undefined)).toBeUndefined();
    expect(extractAuthorityFromCtxId(null)).toBeUndefined();
    expect(extractAuthorityFromCtxId(42)).toBeUndefined();
  });
  it('returns undefined when the acdp:// prefix is followed by an empty authority', () => {
    expect(extractAuthorityFromCtxId('acdp:///01ABC')).toBeUndefined();
  });
});
