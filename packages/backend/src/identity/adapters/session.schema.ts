import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { owners } from './owner.schema.js';

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => owners.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('sessions_owner_id_idx').on(table.ownerId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

// A single database-backed budget protects this single-owner app across restarts.
export const loginThrottle = pgTable(
  'login_throttle',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    attempts: integer('attempts').notNull(),
    windowStartedAt: timestamp('window_started_at', {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    check('login_throttle_singleton_true', sql`${table.singleton} = true`),
  ],
);
