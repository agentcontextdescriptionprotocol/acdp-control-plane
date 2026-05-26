import { Injectable } from '@nestjs/common';
import {
  RevocationRecord,
  RevocationRepository,
} from './revocation-repository';

@Injectable()
export class InMemoryRevocationRepository implements RevocationRepository {
  private readonly store = new Map<string, RevocationRecord>();

  async revoke(record: RevocationRecord): Promise<boolean> {
    if (this.store.has(record.jti)) return false;
    this.store.set(record.jti, { ...record, revokedAt: record.revokedAt ?? new Date() });
    return true;
  }

  async isRevoked(jti: string): Promise<boolean> {
    const rec = this.store.get(jti);
    if (!rec) return false;
    if (rec.exp < nowSeconds()) {
      // Lazy eviction — JWT verification will reject expired tokens
      // anyway; the entry no longer needs to occupy the deny-list.
      this.store.delete(jti);
      return false;
    }
    return true;
  }

  async get(jti: string): Promise<RevocationRecord | null> {
    return this.store.get(jti) ?? null;
  }

  async evictExpired(): Promise<number> {
    const now = nowSeconds();
    let evicted = 0;
    for (const [jti, rec] of this.store) {
      if (rec.exp < now) {
        this.store.delete(jti);
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
