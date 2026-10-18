import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { readDatabaseEnvironment } from './src/config/environment.js';

// pnpm db:generate runs this command with packages/backend as its working directory.
config({ path: '../../.env', quiet: true });
const environment = readDatabaseEnvironment();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: environment.DATABASE_URL },
  strict: true,
});
