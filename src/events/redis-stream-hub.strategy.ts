import { Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { AcdpStreamEvent } from '../contracts/acdp';
import { StreamHubStrategy } from './stream-hub.interface';

interface RedisEnvelope {
  scope: 'run' | 'global';
  runId?: string;
  event: AcdpStreamEvent;
}

/**
 * Redis pub/sub StreamHub strategy for horizontal scaling. Publishes to a
 * shared channel and re-emits inbound messages on local Subjects so that any
 * subscriber on any instance receives the event.
 *
 * Requires `ioredis` as an optional peer dependency.
 */
export class RedisStreamHubStrategy implements StreamHubStrategy {
  private readonly logger = new Logger(RedisStreamHubStrategy.name);
  private readonly localSubject = new Subject<RedisEnvelope>();
  private publisher: {
    publish: (channel: string, message: string) => Promise<number>;
    quit: () => Promise<string>;
  } | null = null;
  private subscriber: {
    subscribe: (channel: string, cb?: (err: Error | null) => void) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    quit: () => Promise<string>;
  } | null = null;
  private readonly channel = 'acdp:stream-hub';

  constructor(redisUrl: string) {
    void this.connect(redisUrl);
  }

  private async connect(redisUrl: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      this.publisher = new Redis(redisUrl);
      this.subscriber = new Redis(redisUrl);

      this.subscriber!.subscribe(this.channel, (err: Error | null) => {
        if (err) {
          this.logger.error(`Failed to subscribe to Redis channel: ${err.message}`);
        } else {
          this.logger.log('Connected to Redis stream hub');
        }
      });

      this.subscriber!.on('message', (_channel: unknown, message: unknown) => {
        try {
          const parsed = JSON.parse(message as string) as RedisEnvelope;
          this.localSubject.next(parsed);
        } catch (err) {
          this.logger.warn(
            `Failed to parse Redis message: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to connect to Redis: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  publishToRun(runId: string, event: AcdpStreamEvent): void {
    this.publish({ scope: 'run', runId, event });
  }

  publishGlobal(event: AcdpStreamEvent): void {
    this.publish({ scope: 'global', event });
  }

  streamRun(runId: string): Observable<AcdpStreamEvent> {
    return this.localSubject.asObservable().pipe(
      filter((msg) => msg.scope === 'run' && msg.runId === runId),
      map((msg) => msg.event),
    );
  }

  streamGlobal(): Observable<AcdpStreamEvent> {
    return this.localSubject.asObservable().pipe(
      filter((msg) => msg.scope === 'global'),
      map((msg) => msg.event),
    );
  }

  destroy(): void {
    this.localSubject.complete();
    if (this.publisher) void this.publisher.quit().catch(() => {});
    if (this.subscriber) void this.subscriber.quit().catch(() => {});
  }

  private publish(envelope: RedisEnvelope): void {
    if (this.publisher) {
      this.publisher.publish(this.channel, JSON.stringify(envelope)).catch((err: Error) => {
        this.logger.warn(`Failed to publish to Redis: ${err.message}`);
      });
    }
    // Also emit locally so same-instance subscribers don't depend on the round-trip
    this.localSubject.next(envelope);
  }
}
