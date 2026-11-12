import { sql } from 'drizzle-orm';
import {
  check,
  integer,
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
    text: text('text'),
    sourceRequest: text('source_request'),
    revision: integer('revision').notNull().default(1),
    lastMutationRequestId: uuid('last_mutation_request_id'),
    forgottenAt: timestamp('forgotten_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('memory_revision_positive', sql`${table.revision} > 0`),
    check(
      'memory_content_state',
      sql`(${table.forgottenAt} is null and ${table.text} is not null and ${table.sourceRequest} is not null) or (${table.forgottenAt} is not null and ${table.text} is null and ${table.sourceRequest} is null)`,
    ),
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
