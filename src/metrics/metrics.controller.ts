import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { InstrumentationService } from '../telemetry/instrumentation.service';

@ApiExcludeController()
@Controller()
@Public()
export class MetricsController {
  constructor(private readonly instrumentation: InstrumentationService) {}

  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    const metrics = await this.instrumentation.getMetrics();
    res.set('Content-Type', this.instrumentation.getContentType());
    res.end(metrics);
  }
}
