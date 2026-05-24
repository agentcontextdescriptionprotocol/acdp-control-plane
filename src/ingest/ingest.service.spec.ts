import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { EventProcessorService } from '../processor/event-processor.service';
import { IngestService } from './ingest.service';

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
    );
  });

  it('prefers X-Run-Id header over payload.run_id when both are present', async () => {
    const withEmbedded = { ...validPayload, run_id: 'payload-run' };
    const body = Buffer.from(JSON.stringify(withEmbedded));
    await service.handle(body, sign(body), 'header-run');
    expect(processor.process).toHaveBeenCalledWith(expect.any(Object), 'header-run');
  });

  it('falls back to payload.run_id when no header is provided', async () => {
    const withEmbedded = { ...validPayload, run_id: 'payload-run' };
    const body = Buffer.from(JSON.stringify(withEmbedded));
    await service.handle(body, sign(body), undefined);
    expect(processor.process).toHaveBeenCalledWith(expect.any(Object), 'payload-run');
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
    config.webhookSecret = '';
    service = new IngestService(
      config as AppConfigService,
      processor as unknown as EventProcessorService,
    );
    const body = Buffer.from(JSON.stringify(validPayload));
    await service.handle(body, '', undefined);
    expect(processor.process).toHaveBeenCalledTimes(1);
  });
});
