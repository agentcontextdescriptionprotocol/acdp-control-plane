import { firstValueFrom, take, toArray } from 'rxjs';
import { AcdpStreamEvent } from '../contracts/acdp';
import { MemoryStreamHubStrategy } from './memory-stream-hub.strategy';

function event(overrides: Partial<AcdpStreamEvent> = {}): AcdpStreamEvent {
  return {
    type: 'context_published',
    ts: '2026-01-01T00:00:00Z',
    runId: 'r1',
    ctxId: 'acdp://reg/c1',
    agentId: 'did:web:a.example',
    contextType: 'task',
    registryAuthority: 'reg.example',
    derivedFrom: [],
    ...overrides,
  };
}

describe('MemoryStreamHubStrategy', () => {
  let hub: MemoryStreamHubStrategy;

  beforeEach(() => {
    hub = new MemoryStreamHubStrategy();
  });

  afterEach(() => {
    hub.destroy();
  });

  it('delivers per-run events to subscribers on streamRun', async () => {
    const stream = hub.streamRun('r1').pipe(take(2), toArray());
    const collected = firstValueFrom(stream);

    // Publish synchronously after subscription
    setImmediate(() => {
      hub.publishToRun('r1', event({ ts: 't1' }));
      hub.publishToRun('r1', event({ ts: 't2' }));
    });

    const events = await collected;
    expect(events.map((e) => e.ts)).toEqual(['t1', 't2']);
  });

  it('does not deliver one run\'s events to another run\'s subscribers', async () => {
    const received: AcdpStreamEvent[] = [];
    const sub = hub.streamRun('r1').subscribe((e) => received.push(e));

    hub.publishToRun('r2', event({ runId: 'r2', ts: 't-other' }));
    hub.publishToRun('r1', event({ ts: 't-mine' }));

    // Let microtasks flush
    await new Promise((r) => setImmediate(r));
    sub.unsubscribe();

    expect(received.map((e) => e.ts)).toEqual(['t-mine']);
  });

  it('global stream receives every publishGlobal event', async () => {
    const stream = hub.streamGlobal().pipe(take(2), toArray());
    const collected = firstValueFrom(stream);

    setImmediate(() => {
      hub.publishGlobal(event({ ts: 'g1' }));
      hub.publishGlobal(event({ ts: 'g2' }));
    });

    const events = await collected;
    expect(events.map((e) => e.ts)).toEqual(['g1', 'g2']);
  });

  it('global stream does not double-deliver per-run events (separation is the processor\'s job)', async () => {
    const received: AcdpStreamEvent[] = [];
    const sub = hub.streamGlobal().subscribe((e) => received.push(e));

    hub.publishToRun('r1', event({ ts: 'per-run' }));

    await new Promise((r) => setImmediate(r));
    sub.unsubscribe();

    expect(received).toEqual([]);
  });

  it('destroy completes all subjects so no further events are received', async () => {
    const received: AcdpStreamEvent[] = [];
    const sub = hub.streamGlobal().subscribe({
      next: (e) => received.push(e),
    });

    hub.destroy();
    hub.publishGlobal(event({ ts: 'post-destroy' }));

    await new Promise((r) => setImmediate(r));
    sub.unsubscribe();

    expect(received).toEqual([]);
  });
});
