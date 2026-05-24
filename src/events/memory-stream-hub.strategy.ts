import { Observable, Subject } from 'rxjs';
import { AcdpStreamEvent } from '../contracts/acdp';
import { StreamHubStrategy } from './stream-hub.interface';

/**
 * In-memory StreamHub strategy using RxJS Subjects. Suitable for
 * single-instance deployments. Per-run subjects are GC'd after a grace period
 * with no subscribers.
 */
export class MemoryStreamHubStrategy implements StreamHubStrategy {
  private readonly runSubjects = new Map<string, Subject<AcdpStreamEvent>>();
  private readonly runSubscriberCounts = new Map<string, number>();
  private readonly runCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly globalSubject = new Subject<AcdpStreamEvent>();

  publishToRun(runId: string, event: AcdpStreamEvent): void {
    this.getRunSubject(runId).next(event);
  }

  publishGlobal(event: AcdpStreamEvent): void {
    this.globalSubject.next(event);
  }

  streamRun(runId: string): Observable<AcdpStreamEvent> {
    const existingTimer = this.runCleanupTimers.get(runId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.runCleanupTimers.delete(runId);
    }

    const subject = this.getRunSubject(runId);
    this.runSubscriberCounts.set(runId, (this.runSubscriberCounts.get(runId) ?? 0) + 1);

    return new Observable<AcdpStreamEvent>((subscriber) => {
      const subscription = subject.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        const count = (this.runSubscriberCounts.get(runId) ?? 1) - 1;
        this.runSubscriberCounts.set(runId, count);
        if (count <= 0) this.scheduleCleanup(runId);
      };
    });
  }

  streamGlobal(): Observable<AcdpStreamEvent> {
    return this.globalSubject.asObservable();
  }

  destroy(): void {
    for (const [, timer] of this.runCleanupTimers) clearTimeout(timer);
    for (const [, subject] of this.runSubjects) subject.complete();
    this.runSubjects.clear();
    this.runSubscriberCounts.clear();
    this.runCleanupTimers.clear();
    this.globalSubject.complete();
  }

  private getRunSubject(runId: string): Subject<AcdpStreamEvent> {
    let subject = this.runSubjects.get(runId);
    if (!subject) {
      subject = new Subject<AcdpStreamEvent>();
      this.runSubjects.set(runId, subject);
    }
    return subject;
  }

  private scheduleCleanup(runId: string): void {
    const existing = this.runCleanupTimers.get(runId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.runCleanupTimers.delete(runId);
      const count = this.runSubscriberCounts.get(runId) ?? 0;
      if (count <= 0) {
        const subject = this.runSubjects.get(runId);
        if (subject) {
          subject.complete();
          this.runSubjects.delete(runId);
          this.runSubscriberCounts.delete(runId);
        }
      }
    }, 60_000);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();

    this.runCleanupTimers.set(runId, timer);
  }
}
