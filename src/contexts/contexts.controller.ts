import { Controller, Get, Logger, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RegistryRepository } from '../storage/registry.repository';

@ApiTags('contexts')
@Controller('contexts')
export class ContextsController {
  private readonly logger = new Logger(ContextsController.name);

  constructor(private readonly registryRepo: RegistryRepository) {}

  @Get(':ctxId(.*)')
  @ApiOperation({
    summary:
      'Federated context retrieval — proxied to the registry that authored it. ctx_id format: acdp://<authority>/<uuid>',
  })
  async getContext(@Param('ctxId') ctxId: string, @Res() res: Response): Promise<void> {
    const stripped = ctxId.replace(/^acdp:\/\//, '');
    const [authority] = stripped.split('/');
    if (!authority) {
      throw new NotFoundException(`Invalid ctx_id format: ${ctxId}`);
    }

    const registry = await this.registryRepo.findByAuthority(authority);
    if (!registry?.baseUrl) {
      throw new NotFoundException(`Unknown registry authority: ${authority}`);
    }

    const upstream = `${registry.baseUrl.replace(/\/$/, '')}/contexts/${ctxId}`;

    try {
      const response = await fetch(upstream, {
        signal: AbortSignal.timeout(10_000),
      });
      const contentType = response.headers.get('content-type') ?? 'application/json';
      const body = await response.text();
      res.status(response.status).set('Content-Type', contentType).send(body);
    } catch (err) {
      this.logger.warn(
        `federation proxy GET ${upstream} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new NotFoundException(
        `Upstream registry ${authority} unreachable for ${ctxId}`,
      );
    }
  }
}
