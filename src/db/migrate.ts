/**
 * Programmatic migration runner.
 *
 * Reads SQL files from the drizzle/ directory and applies them in order,
 * tracking applied migrations in a `_migrations` table. Avoids depending on
 * drizzle-kit (a devDependency) at runtime.
 *
 * Usage:
 *   - Imported:   `await runMigrations(databaseUrl)`
 *   - Standalone: `node dist/db/migrate.js`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_TABLE = '_migrations';

/* eslint-disable no-console -- migration CLI uses console for progress output */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsDir = path.resolve(__dirname, '..', '..', 'drizzle');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        name varchar(255) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      return;
    }

    const result = await client.query<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`,
    );
    const applied = new Set(result.rows.map((r) => r.name));

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log(`All ${files.length} migrations already applied.`);
      return;
    }

    console.log(`Applying ${pending.length} migration(s)...`);

    for (const file of pending) {
      const filePath = path.join(migrationsDir, file);
      const sqlText = fs.readFileSync(filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(
          `  ✗ ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }

    console.log('Migrations complete.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@localhost:5432/acdp_control_plane';

  runMigrations(databaseUrl).catch((err) => {
    console.error('Migration failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
