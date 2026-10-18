import { readDatabaseEnvironment } from '../config/environment.js';
import { createDatabase } from './database.js';
import { migrateDatabase } from './migrations.js';

async function main() {
  const connection = createDatabase(readDatabaseEnvironment());
  connection.pool.on('error', () => {
    console.error('Database connection failed during migration');
  });
  try {
    await migrateDatabase(connection);
    console.info('Database migrations applied');
  } finally {
    await connection.pool.end();
  }
}

main().catch(() => {
  console.error(
    'Migration failed. Check database configuration, access, and SQL migrations.',
  );
  process.exitCode = 1;
});
