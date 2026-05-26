/**
 * Integration test for the Postgres-backed challenge + revocation
 * repositories. Requires the test DB stack from `test/setup/`.
 *
 * Runs the shared contract suite against PostgresChallengeRepository
 * and PostgresRevocationRepository so the same behavioral guarantees
 * we test in-process are exercised against real SQL.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runChallengeRepositoryContract } from '../../src/auth/challenge-repository.contract';
import { runRevocationRepositoryContract } from '../../src/auth/revocation-repository.contract';
import { PostgresChallengeRepository } from '../../src/auth/postgres-challenge.repository';
import { PostgresRevocationRepository } from '../../src/auth/postgres-revocation.repository';
import { DatabaseService } from '../../src/db/database.service';
import { TEST_DB_URL } from '../helpers/test-db';
import * as schema from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrate';

let pool: Pool;
let dbService: DatabaseService;

beforeAll(async () => {
  await runMigrations(TEST_DB_URL);
  pool = new Pool({ connectionString: TEST_DB_URL });
  // Build a minimal DatabaseService surface — we don't need the full
  // pool/lifecycle harness for unit-level integration.
  dbService = {
    pool,
    db: drizzle(pool, { schema }),
    hasFatalError: false,
    onModuleDestroy: async () => { await pool.end(); },
    tryAdvisoryLock: async () => true,
    advisoryUnlock: async () => {},
  } as unknown as DatabaseService;
});

afterAll(async () => {
  await pool.end();
});

async function clean() {
  await pool.query('TRUNCATE TABLE auth_challenges, revoked_tokens');
}

describe('PostgresChallengeRepository (integration)', () => {
  runChallengeRepositoryContract(async () => {
    await clean();
    return new PostgresChallengeRepository(dbService);
  });

  it('take is atomic across concurrent SELECT FOR UPDATE-like contention', async () => {
    // Run 10 simultaneous take()s for the same nonce — DELETE..RETURNING
    // should serialize them at the database so exactly one returns
    // the row.
    await clean();
    const repo = new PostgresChallengeRepository(dbService);
    const nonce = `concurrent-${Date.now()}`;
    await repo.put({
      nonce,
      agentDid: 'did:web:alice',
      registryAuthority: 'cp.test',
      signingInput: 'x',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.take(nonce)),
    );
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });

  it('TTL filter on take() refuses an expired row even mid-statement', async () => {
    await clean();
    const repo = new PostgresChallengeRepository(dbService);
    const nonce = `tick-${Date.now()}`;
    await repo.put({
      nonce,
      agentDid: 'did:web:alice',
      registryAuthority: 'cp.test',
      signingInput: 'x',
      expiresAt: Math.floor(Date.now() / 1000) - 1, // already expired
    });
    expect(await repo.take(nonce)).toBeNull();
  });
});

describe('PostgresRevocationRepository (integration)', () => {
  runRevocationRepositoryContract(async () => {
    await clean();
    return new PostgresRevocationRepository(dbService);
  });

  it('revoke is idempotent under concurrent writes', async () => {
    await clean();
    const repo = new PostgresRevocationRepository(dbService);
    const record = {
      jti: `jti-${Date.now()}`,
      sub: 'did:web:alice',
      iss: 'cp.test',
      exp: Math.floor(Date.now() / 1000) + 60,
      revokedBy: 'admin',
      reason: 'admin_revoke' as const,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => repo.revoke(record)),
    );
    const newlyRevoked = results.filter(Boolean);
    expect(newlyRevoked).toHaveLength(1);
  });
});
