import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { readDatabaseEnvironment } from '../config/environment.js';
import { createDatabase } from './database.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly connection = createDatabase(readDatabaseEnvironment());
  readonly db = this.connection.db;

  constructor() {
    this.connection.pool.on('error', () => {
      this.logger.error('An idle database connection failed');
    });
  }

  async checkReady(): Promise<void> {
    const result = await this.db.execute<{ installed: boolean }>(sql`
      select exists (
        select 1 from pg_extension where extname = 'vector'
      ) as installed
    `);
    if (result.rows[0]?.installed !== true) {
      throw new Error('Database bootstrap migration is missing');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection.pool.end();
  }
}
