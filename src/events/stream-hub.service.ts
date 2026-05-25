import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AcdpStreamEvent } from '../contracts/acdp';
import { STREAM_HUB_STRATEGY, StreamHubStrategy } from './stream-hub.interface';

@Injectable()
export class StreamHubService implements OnModuleDestroy {
  constructor(
    @Inject(STREAM_HUB_STRATEGY) private readonly strategy: StreamHubStrategy,
  ) {}

  onModuleDestroy(): void {
    if ('destroy' in this.strategy && typeof this.strategy.destroy === 'function') {
      this.strategy.destroy();
    }
  }

  publishToRun(runId: string, event: AcdpStreamEvent): void {
    this.strategy.publishToRun(runId, event);
  }

  publishGlobal(event: AcdpStreamEvent): void {
    this.strategy.publishGlobal(event);
  }

  streamRun(runId: string): Observable<AcdpStreamEvent> {
    return this.strategy.streamRun(runId);
  }

  streamGlobal(): Observable<AcdpStreamEvent> {
    return this.strategy.streamGlobal();
  }
}
