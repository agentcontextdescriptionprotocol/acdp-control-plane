import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { Run } from '../db/schema';
import { ListRunsOptions, RunRepository } from '../storage/run.repository';

@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    private readonly runRepo: RunRepository,
    private readonly config: AppConfigService,
  ) {}

  async list(opts: ListRunsOptions): Promise<{
    data: Run[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { data, total } = await this.runRepo.list(opts);
    return { data, total, limit: opts.limit, offset: opts.offset };
  }

  async getOrThrow(runId: string): Promise<Run> {
    return this.runRepo.findByIdOrThrow(runId);
  }

  async markComplete(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    result?: Record<string, unknown>,
  ): Promise<Run> {
    const run = await this.runRepo.markComplete(runId, status, result);

    // Optionally notify the playground that the run is complete.
    if (this.config.playgroundUrl) {
      void this.notifyPlayground(runId, status, result);
    }

    return run;
  }

  private async notifyPlayground(
    runId: string,
    status: string,
    result?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const url = `${this.config.playgroundUrl.replace(/\/$/, '')}/runs/${runId}/complete`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, result }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.warn(
          `playground notify ${runId} returned ${response.status}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `playground notify ${runId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
