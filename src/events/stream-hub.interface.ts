import { Observable } from 'rxjs';
import { AcdpStreamEvent } from '../contracts/acdp';

export const STREAM_HUB_STRATEGY = 'STREAM_HUB_STRATEGY';

export interface StreamHubStrategy {
  publishToRun(runId: string, event: AcdpStreamEvent): void;
  publishGlobal(event: AcdpStreamEvent): void;
  streamRun(runId: string): Observable<AcdpStreamEvent>;
  streamGlobal(): Observable<AcdpStreamEvent>;
  destroy?(): void;
}
