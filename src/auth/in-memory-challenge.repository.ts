import { Injectable } from '@nestjs/common';
import {
  ChallengeRecord,
  ChallengeRepository,
} from './challenge-repository';

@Injectable()
export class InMemoryChallengeRepository implements ChallengeRepository {
  private readonly store = new Map<string, ChallengeRecord>();

  async put(record: ChallengeRecord): Promise<void> {
    this.store.set(record.nonce, record);
  }

  async take(nonce: string): Promise<ChallengeRecord | null> {
    const rec = this.store.get(nonce);
    if (!rec) return null;
    this.store.delete(nonce);
    if (rec.expiresAt < nowSeconds()) return null;
    return rec;
  }

  async evictExpired(): Promise<number> {
    const now = nowSeconds();
    let evicted = 0;
    for (const [nonce, rec] of this.store) {
      if (rec.expiresAt < now) {
        this.store.delete(nonce);
        evicted++;
      }
    }
    return evicted;
  }

  async size(): Promise<number> {
    await this.evictExpired();
    return this.store.size;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
