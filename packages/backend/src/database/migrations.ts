import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DatabaseConnection } from './database.js';

export async function migrateDatabase(
  connection: DatabaseConnection,
): Promise<void> {
  const migrationsFolder = fileURLToPath(
    new URL('../../drizzle/', import.meta.url),
  );
  await migrate(connection.db, { migrationsFolder });
}
