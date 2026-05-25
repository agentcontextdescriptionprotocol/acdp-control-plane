import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { IngestService } from './ingest.service';

@ApiTags('ingest')
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post('acdp')
  @HttpCode(204)
  @Public()
  @ApiOperation({
    summary: 'Receive an ACDP webhook event from a registry. Authenticated by HMAC-SHA256.',
  })
  async receiveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-acdp-signature') signature: string,
    @Headers('x-run-id') runId?: string,
  ): Promise<void> {
    const body = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    await this.ingestService.handle(body, signature, runId);
  }

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Liveness check for registry configuration tests.' })
  health() {
    return { ok: true };
  }
}
