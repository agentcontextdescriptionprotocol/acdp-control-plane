import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfigService } from '../config/app-config.service';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
  hasFatalError = false;

  constructor(config: AppConfigService) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      idleTimeoutMillis: config.dbPoolIdleTimeout,
      connectionTimeoutMillis: config.dbPoolConnectionTimeout,
    });
    this.pool.on('error', (err) => {
      this.logger.error(`database pool error: ${err.message}`);
      this.hasFatalError = true;
    });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async tryAdvisoryLock(key: string): Promise<boolean> {
    const result = await this.db.execute(
      sql`SELECT pg_try_advisory_lock(hashtext(${key})) AS acquired`,
    );
    return (result.rows[0] as { acquired: boolean })?.acquired === true;
  }

  async advisoryUnlock(key: string): Promise<void> {
    await this.db.execute(sql`SELECT pg_advisory_unlock(hashtext(${key}))`);
  }
}
