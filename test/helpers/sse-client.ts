import * as http from 'node:http';

export interface SSEEvent {
  type: string;
  data: unknown;
  id?: string;
  raw: string;
}

/**
 * Lightweight SSE client for integration tests. Connects to a control-plane
 * SSE endpoint, accumulates events, and exposes a `waitForEvent` primitive.
 */
export class TestSSEClient {
  readonly events: SSEEvent[] = [];

  private request: http.ClientRequest | null = null;
  private closed = false;
  private waiters: Array<{
    predicate: (event: SSEEvent) => boolean;
    resolve: (event: SSEEvent) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  /**
   * Connect to an SSE endpoint at `path`. Returns a promise that resolves
   * when the underlying HTTP response begins (the headers arrive).
   */
  connect(path: string): Promise<void> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    return new Promise((resolve, reject) => {
      this.request = http.get(url.toString(), { headers }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`SSE connect failed: HTTP ${res.statusCode}`));
          return;
        }

        resolve();
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const event = this.parseSSEBlock(part);
            if (event) {
              this.events.push(event);
              this.dispatchToWaiters(event);
            }
          }
        });

        res.on('end', () => {
          this.closed = true;
          if (buffer.trim()) {
            const event = this.parseSSEBlock(buffer);
            if (event) {
              this.events.push(event);
              this.dispatchToWaiters(event);
            }
          }
          for (const w of this.waiters) w.reject(new Error('SSE stream ended'));
          this.waiters = [];
        });

        res.on('error', (err) => {
          for (const w of this.waiters) w.reject(err);
          this.waiters = [];
        });
      });

      this.request.on('error', reject);
    });
  }

  waitForEvent(type: string, timeoutMs = 10000): Promise<SSEEvent> {
    const existing = this.events.find((e) => e.type === type);
    if (existing) return Promise.resolve(existing);
    return this.waitFor((e) => e.type === type, timeoutMs);
  }

  getEventsByType(type: string): SSEEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Non-heartbeat events only. */
  getDataEvents(): SSEEvent[] {
    return this.events.filter((e) => e.type !== 'heartbeat');
  }

  close(): void {
    this.closed = true;
    this.request?.destroy();
    this.request = null;
  }

  private waitFor(
    predicate: (event: SSEEvent) => boolean,
    timeoutMs: number,
  ): Promise<SSEEvent> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('SSE stream already closed'));
        return;
      }
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrappedResolve);
        reject(new Error(`Timeout waiting for SSE event (${timeoutMs}ms)`));
      }, timeoutMs);
      const wrappedResolve = (event: SSEEvent) => {
        clearTimeout(timer);
        resolve(event);
      };
      this.waiters.push({
        predicate,
        resolve: wrappedResolve,
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private dispatchToWaiters(event: SSEEvent): void {
    const matched: typeof this.waiters = [];
    this.waiters = this.waiters.filter((w) => {
      if (w.predicate(event)) {
        matched.push(w);
        return false;
      }
      return true;
    });
    for (const w of matched) w.resolve(event);
  }

  private parseSSEBlock(block: string): SSEEvent | null {
    const lines = block.split('\n');
    let type = 'message';
    let data = '';
    let id: string | undefined;
    for (const line of lines) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
      else if (line.startsWith('id:')) id = line.slice(3).trim();
    }
    if (!data && type === 'message') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }
    return { type, data: parsed, id, raw: block };
  }
}
