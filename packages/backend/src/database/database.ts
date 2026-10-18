import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { DatabaseEnvironment } from '../config/environment.js';
import * as schema from './schema.js';

export function createDatabase(environment: DatabaseEnvironment) {
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: environment.DATABASE_POOL_MAX,
    connectionTimeoutMillis: environment.DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
