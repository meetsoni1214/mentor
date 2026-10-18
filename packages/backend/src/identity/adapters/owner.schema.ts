import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const owners = pgTable(
  'owners',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Every row must claim the same unique slot, including concurrent inserts.
    singleton: boolean('singleton').notNull().default(true).unique(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check('owners_singleton_true', sql`${table.singleton} = true`)],
);
