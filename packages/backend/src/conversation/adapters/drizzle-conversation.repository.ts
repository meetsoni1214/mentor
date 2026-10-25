import { and, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { DatabaseConnection } from '../../database/database.js';
import { owners } from '../../identity/adapters/driven/persistence/drizzle/owner.schema.js';
import {
  assertRetryable,
  canFinish,
  ConversationError,
} from '../domain/conversation.js';
import type {
  Admission,
  AttemptReference,
  RetryRequest,
  RunLimits,
  Submission,
} from '../application/conversation.contracts.js';
import type { ConversationRepository } from '../application/ports/conversation.repository.js';
import type { RunOutcome } from '../domain/conversation.js';
import {
  assertHistoryVersion,
  assertNoRunningAttempt,
  decideSubmission,
  replayRetry,
} from '../domain/admission-policy.js';
import {
  conversationAttempts as attempts,
  conversationTurns as turns,
  conversations,
} from './conversation.schema.js';

type Transaction = Parameters<
  Parameters<DatabaseConnection['db']['transaction']>[0]
>[0];
type Conversation = typeof conversations.$inferSelect;

export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly db: DatabaseConnection['db']) {}

  private locked<T>(
    ownerId: string,
    operation: (tx: Transaction, now: Date) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: owners.id })
        .from(owners)
        .where(eq(owners.id, ownerId))
        .for('update');
      if (!owner) throw new ConversationError('NOT_FOUND');
      // Read after acquiring the lock, rather than transaction-start time.
      const result = await tx.execute<{ now: string }>(
        sql`select clock_timestamp() as now`,
      );
      const timestamp = result.rows[0]?.now;
      const now = timestamp ? new Date(timestamp) : null;
      if (!now || !Number.isFinite(now.getTime()))
        throw new Error('Database clock unavailable');
      return operation(tx, now);
    });
  }

  private async resolve(
    tx: Transaction,
    ownerId: string,
  ): Promise<Conversation> {
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.ownerId, ownerId));
    if (existing) return existing;
    const [created] = await tx
      .insert(conversations)
      .values({ ownerId })
      .returning();
    if (!created) throw new Error('Conversation unavailable');
    return created;
  }

  private async reconcile(
    tx: Transaction,
    conversationId: string,
    now: Date,
  ): Promise<void> {
    await tx
      .update(attempts)
      .set({ state: 'interrupted', errorCode: 'INTERRUPTED', finishedAt: now })
      .where(
        and(
          eq(attempts.conversationId, conversationId),
          eq(attempts.state, 'running'),
          lte(attempts.deadlineAt, now),
        ),
      );
  }

  private async hasRunningAttempt(
    tx: Transaction,
    conversationId: string,
  ): Promise<boolean> {
    const [active] = await tx
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        and(
          eq(attempts.conversationId, conversationId),
          eq(attempts.state, 'running'),
        ),
      )
      .limit(1);
    return active !== undefined;
  }

  async submit(input: Submission, limits: RunLimits): Promise<Admission> {
    return this.locked(input.ownerId, async (tx, now) => {
      const conversation = await this.resolve(tx, input.ownerId);
      assertHistoryVersion(conversation.historyVersion, input.historyVersion);
      await this.reconcile(tx, conversation.id, now);
      const [existing] = await tx
        .select()
        .from(turns)
        .where(
          and(
            eq(turns.conversationId, conversation.id),
            eq(turns.requestId, input.requestId),
          ),
        );
      const [keyCollision] = existing
        ? []
        : await tx
            .select({ id: attempts.id })
            .from(attempts)
            .where(
              and(
                eq(attempts.conversationId, conversation.id),
                eq(attempts.requestId, input.requestId),
              ),
            )
            .limit(1);
      const decision = decideSubmission(input.text, {
        existingTurn: existing ?? null,
        requestIdInUse: keyCollision !== undefined,
        hasRunningAttempt:
          !existing &&
          !keyCollision &&
          (await this.hasRunningAttempt(tx, conversation.id)),
      });
      if (decision.kind === 'replay') {
        const [attempt] = await tx
          .select()
          .from(attempts)
          .where(eq(attempts.turnId, decision.turn.id))
          .orderBy(desc(attempts.attemptNumber))
          .limit(1);
        if (!attempt) throw new Error('Accepted turn has no attempt');
        return {
          execute: false,
          historyVersion: conversation.historyVersion,
          turn: decision.turn,
          attempt,
        };
      }
      const [turn] = await tx
        .insert(turns)
        .values({
          conversationId: conversation.id,
          requestId: input.requestId,
          sequence: conversation.nextSequence,
          text: input.text,
          createdAt: now,
        })
        .returning();
      if (!turn) throw new Error('Turn unavailable');
      await tx
        .update(conversations)
        .set({ nextSequence: conversation.nextSequence + 1 })
        .where(eq(conversations.id, conversation.id));
      const [attempt] = await tx
        .insert(attempts)
        .values({
          conversationId: conversation.id,
          turnId: turn.id,
          requestId: input.requestId,
          model: limits.model,
          attemptNumber: 1,
          state: 'running',
          startedAt: now,
          deadlineAt: new Date(now.getTime() + limits.deadlineMs),
        })
        .returning();
      if (!attempt) throw new Error('Attempt unavailable');
      return {
        execute: true,
        historyVersion: conversation.historyVersion,
        turn,
        attempt,
      };
    });
  }

  async retry(input: RetryRequest, limits: RunLimits): Promise<Admission> {
    return this.locked(input.ownerId, async (tx, now) => {
      const conversation = await this.resolve(tx, input.ownerId);
      assertHistoryVersion(conversation.historyVersion, input.historyVersion);
      await this.reconcile(tx, conversation.id, now);
      const [turn] = await tx
        .select()
        .from(turns)
        .where(
          and(
            eq(turns.id, input.turnId),
            eq(turns.conversationId, conversation.id),
          ),
        );
      if (!turn) throw new ConversationError('NOT_FOUND');
      const [existing] = await tx
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.conversationId, conversation.id),
            eq(attempts.requestId, input.requestId),
          ),
        );
      const replay = replayRetry(turn.id, existing ?? null);
      if (replay) {
        return {
          execute: false,
          historyVersion: conversation.historyVersion,
          turn,
          attempt: replay,
        };
      }
      const [latestTurn] = await tx
        .select({ id: turns.id })
        .from(turns)
        .where(eq(turns.conversationId, conversation.id))
        .orderBy(desc(turns.sequence))
        .limit(1);
      const [latestAttempt] = await tx
        .select()
        .from(attempts)
        .where(eq(attempts.turnId, turn.id))
        .orderBy(desc(attempts.attemptNumber))
        .limit(1);
      if (!latestTurn || !latestAttempt)
        throw new Error('Accepted turn unavailable');
      assertRetryable(turn.id, latestTurn.id, latestAttempt.state);
      assertNoRunningAttempt(await this.hasRunningAttempt(tx, conversation.id));
      const [attempt] = await tx
        .insert(attempts)
        .values({
          conversationId: conversation.id,
          turnId: turn.id,
          requestId: input.requestId,
          attemptNumber: latestAttempt.attemptNumber + 1,
          model: limits.model,
          state: 'running',
          startedAt: now,
          deadlineAt: new Date(now.getTime() + limits.deadlineMs),
        })
        .returning();
      if (!attempt) throw new Error('Attempt unavailable');
      return {
        execute: true,
        historyVersion: conversation.historyVersion,
        turn,
        attempt,
      };
    });
  }

  async finish(ref: AttemptReference, outcome: RunOutcome) {
    return this.locked(ref.ownerId, async (tx, now) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.ownerId, ref.ownerId));
      if (!conversation || conversation.historyVersion !== ref.historyVersion)
        return null;
      await this.reconcile(tx, conversation.id, now);
      const condition = and(
        eq(attempts.id, ref.attemptId),
        eq(attempts.conversationId, conversation.id),
      );
      const [current] = await tx.select().from(attempts).where(condition);
      if (!current) return null;
      if (!canFinish(current.state, current.deadlineAt, now)) return current;
      const [finished] = await tx
        .update(attempts)
        .set(
          outcome.state === 'completed'
            ? {
                state: outcome.state,
                finishedAt: now,
                answer: outcome.answer,
                sources: outcome.sources,
                activity: outcome.activity,
                inputTokens: outcome.usage?.inputTokens ?? null,
                outputTokens: outcome.usage?.outputTokens ?? null,
                contextLimited: outcome.contextLimited,
              }
            : {
                state: outcome.state,
                finishedAt: now,
                errorCode: outcome.errorCode,
              },
        )
        .where(
          and(
            condition,
            eq(attempts.state, 'running'),
            sql`${attempts.deadlineAt} > clock_timestamp()`,
          ),
        )
        .returning();
      if (finished) return finished;
      // The deadline can pass between reading the database clock and UPDATE.
      const clock = await tx.execute<{ now: string }>(
        sql`select clock_timestamp() as now`,
      );
      const timestamp = clock.rows[0]?.now;
      if (!timestamp) throw new Error('Database clock unavailable');
      await this.reconcile(tx, conversation.id, new Date(timestamp));
      const [interrupted] = await tx.select().from(attempts).where(condition);
      return interrupted ?? null;
    });
  }

  async context(ref: AttemptReference, beforeSequence: number) {
    return this.locked(ref.ownerId, async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.ownerId, ref.ownerId));
      if (!conversation) throw new ConversationError('NOT_FOUND');
      assertHistoryVersion(conversation.historyVersion, ref.historyVersion);
      const rows = await tx
        .select({ text: turns.text, answer: attempts.answer })
        .from(turns)
        .innerJoin(attempts, eq(attempts.turnId, turns.id))
        .where(
          and(
            eq(turns.conversationId, conversation.id),
            lt(turns.sequence, beforeSequence),
            eq(attempts.state, 'completed'),
          ),
        )
        .orderBy(desc(turns.sequence))
        .limit(101);
      return rows.map((row) => ({ text: row.text, answer: row.answer ?? '' }));
    });
  }

  async history(
    ownerId: string,
    options: Parameters<ConversationRepository['history']>[1] = {},
  ) {
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ConversationError('INVALID_INPUT');
    return this.locked(ownerId, async (tx, now) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.ownerId, ownerId));
      const historyVersion = conversation?.historyVersion ?? 0;
      if (options.cursor) {
        assertHistoryVersion(historyVersion, options.cursor.historyVersion);
        if (
          !Number.isSafeInteger(options.cursor.beforeSequence) ||
          options.cursor.beforeSequence < 1
        )
          throw new ConversationError('INVALID_INPUT');
      }
      if (!conversation) return { historyVersion, turns: [], nextCursor: null };
      await this.reconcile(tx, conversation.id, now);
      const rows = await tx
        .select()
        .from(turns)
        .where(
          and(
            eq(turns.conversationId, conversation.id),
            options.cursor
              ? lt(turns.sequence, options.cursor.beforeSequence)
              : undefined,
          ),
        )
        .orderBy(desc(turns.sequence))
        .limit(limit + 1);
      const page = rows.slice(0, limit).reverse();
      const records = page.length
        ? await tx
            .select()
            .from(attempts)
            .where(
              inArray(
                attempts.turnId,
                page.map((turn) => turn.id),
              ),
            )
            .orderBy(attempts.attemptNumber)
        : [];
      return {
        historyVersion,
        turns: page.map((turn) => ({
          ...turn,
          attempts: records.filter((attempt) => attempt.turnId === turn.id),
        })),
        nextCursor:
          rows.length > limit && page[0]
            ? { historyVersion, beforeSequence: page[0].sequence }
            : null,
      };
    });
  }

  async clear(ownerId: string, expectedVersion: number): Promise<number> {
    return this.locked(ownerId, async (tx) => {
      const conversation = await this.resolve(tx, ownerId);
      assertHistoryVersion(conversation.historyVersion, expectedVersion);
      await tx.delete(turns).where(eq(turns.conversationId, conversation.id));
      const historyVersion = conversation.historyVersion + 1;
      await tx
        .update(conversations)
        .set({ historyVersion, nextSequence: 1 })
        .where(eq(conversations.id, conversation.id));
      return historyVersion;
    });
  }
}
