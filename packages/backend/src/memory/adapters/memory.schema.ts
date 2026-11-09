import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { owners } from '../../identity/schema.js';

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    text: text('text').notNull(),
    sourceRequest: text('source_request').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('memory_owner_request_unique').on(table.ownerId, table.requestId),
    check(
      'memory_text_bound',
      sql`octet_length(${table.text}) between 1 and 512`,
    ),
    check(
      'memory_source_request_bound',
      sql`octet_length(${table.sourceRequest}) between 1 and 1024`,
    ),
  ],
);
