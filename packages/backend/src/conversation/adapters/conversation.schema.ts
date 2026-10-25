import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { owners } from '../../identity/adapters/owner.schema.js';
import type {
  RunActivity,
  RunErrorCode,
  RunState,
  SourceReference,
} from '../domain/conversation.js';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .unique()
      .references(() => owners.id, { onDelete: 'cascade' }),
    historyVersion: integer('history_version').notNull().default(0),
    nextSequence: integer('next_sequence').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'conversation_version_nonnegative',
      sql`${table.historyVersion} >= 0`,
    ),
    check('conversation_sequence_positive', sql`${table.nextSequence} > 0`),
  ],
);

export const conversationTurns = pgTable(
  'conversation_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    sequence: integer('sequence').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('conversation_turn_request_unique').on(
      table.conversationId,
      table.requestId,
    ),
    unique('conversation_turn_sequence_unique').on(
      table.conversationId,
      table.sequence,
    ),
    unique('conversation_turn_id_conversation_unique').on(
      table.id,
      table.conversationId,
    ),
    check('conversation_turn_sequence_positive', sql`${table.sequence} > 0`),
  ],
);

export const conversationAttempts = pgTable(
  'conversation_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').notNull(),
    requestId: uuid('request_id').notNull(),
    model: text('model').notNull(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    state: text('state').$type<RunState>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    answer: text('answer'),
    errorCode: text('error_code').$type<RunErrorCode>(),
    sources: jsonb('sources').$type<SourceReference[]>().notNull().default([]),
    activity: jsonb('activity').$type<RunActivity[]>().notNull().default([]),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    contextLimited: boolean('context_limited').notNull().default(false),
  },
  (table) => [
    unique('conversation_attempt_request_unique').on(
      table.conversationId,
      table.requestId,
    ),
    check(
      'conversation_attempt_input_tokens_nonnegative',
      sql`${table.inputTokens} >= 0`,
    ),
    check(
      'conversation_attempt_output_tokens_nonnegative',
      sql`${table.outputTokens} >= 0`,
    ),
    unique('conversation_attempt_number_unique').on(
      table.turnId,
      table.attemptNumber,
    ),
    check(
      'conversation_attempt_number_positive',
      sql`${table.attemptNumber} > 0`,
    ),
    foreignKey({
      columns: [table.turnId, table.conversationId],
      foreignColumns: [conversationTurns.id, conversationTurns.conversationId],
      name: 'conversation_attempt_turn_fk',
    }).onDelete('cascade'),
    uniqueIndex('conversation_one_running_attempt')
      .on(table.conversationId)
      .where(sql`${table.state} = 'running'`),
    index('conversation_attempt_turn_idx').on(table.turnId),
    check(
      'conversation_attempt_state_valid',
      sql`${table.state} in ('running', 'completed', 'failed', 'interrupted')`,
    ),
    check(
      'conversation_attempt_deadline_valid',
      sql`${table.deadlineAt} > ${table.startedAt}`,
    ),
    check(
      'conversation_attempt_outcome_valid',
      sql`(
      (${table.state} = 'running' and ${table.finishedAt} is null and ${table.answer} is null and ${table.errorCode} is null)
      or (${table.state} = 'completed' and ${table.finishedAt} is not null and ${table.answer} is not null and ${table.errorCode} is null)
      or (${table.state} in ('failed', 'interrupted') and ${table.finishedAt} is not null and ${table.answer} is null and ${table.errorCode} is not null)
    )`,
    ),
  ],
);
