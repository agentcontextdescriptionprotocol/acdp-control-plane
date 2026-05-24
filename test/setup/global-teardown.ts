import { execSync } from 'node:child_process';

/* eslint-disable no-console */
export default async function globalTeardown(): Promise<void> {
  if (!process.env.CI && !process.env.KEEP_TEST_DB) {
    try {
      execSync('docker compose -f docker-compose.test.yml down', {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
    } catch {
      console.warn('Could not stop docker compose containers.');
    }
  }
  console.log('Integration test global teardown complete.');
}
