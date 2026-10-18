import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  readDatabaseEnvironment,
} from '@mentor/backend';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test') {
  throw new Error(
    'Use pnpm test:integration to provision an isolated mentor_test database',
  );
}

const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);

describe('database bootstrap on a fresh PostgreSQL instance', () => {
  beforeAll(async () => {
    await migrateDatabase(connection);
  });
  afterAll(async () => {
    await connection.pool.end();
  });

  it('installs a working pgvector extension', async () => {
    const result = await connection.pool.query<{ distance: number }>(
      "select '[1,2,3]'::vector <-> '[1,2,3]'::vector as distance",
    );
    expect(result.rows[0]?.distance).toBe(0);
  });

  it('records the migration once and permits a second migration run', async () => {
    await migrateDatabase(connection);
    const result = await connection.pool.query<{ count: number }>(
      'select count(*)::integer as count from drizzle.__drizzle_migrations',
    );
    expect(result.rows[0]?.count).toBe(3);
  });
});
