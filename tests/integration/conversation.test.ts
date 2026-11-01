import { submitTurn, retryTurn } from '../fixtures/conversation-commands.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createDatabase, migrateDatabase } from '@mentor/backend/database';
import { readDatabaseEnvironment } from '@mentor/backend/config';
import { owners } from '@mentor/backend/identity/schema';
import { DrizzleConversationRepository } from '@mentor/backend/conversation/persistence';
import { ConversationLoop } from '@mentor/backend/conversation';
import type {
  Admission,
  ConversationModel,
  RunLimits,
  RunOutcome,
  Submission,
} from '@mentor/backend/conversation';
import {
  conversationAttempts,
  conversationTurns,
  conversations,
} from '@mentor/backend/conversation/schema';
import { readAIEnvironment } from '@mentor/backend/config/ai';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test') {
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
}
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
let ownerId: string;

beforeAll(async () => {
  await migrateDatabase(connection);
});
beforeEach(async () => {
  await connection.pool.query('truncate owners, login_throttle cascade');
  const [owner] = await connection.db
    .insert(owners)
    .values({
      email: 'conversation@example.test',
      passwordHash: 'synthetic-unused-hash',
    })
    .returning();
  if (!owner) throw new Error('Test owner missing');
  ownerId = owner.id;
});
afterAll(async () => {
  await connection.pool.end();
});

async function seedTurn() {
  const [conversation] = await connection.db
    .insert(conversations)
    .values({ ownerId })
    .returning();
  if (!conversation) throw new Error('Test conversation missing');
  const [turn] = await connection.db
    .insert(conversationTurns)
    .values({
      conversationId: conversation.id,
      requestId: randomUUID(),
      sequence: 1,
      text: 'A synthetic message',
    })
    .returning();
  if (!turn) throw new Error('Test turn missing');
  return { conversation, turn };
}

describe('conversation migration constraints', () => {
  it('preserves known, zero, and unknown usage when migrating to constrained token columns', async () => {
    const expected = [
      { inputTokens: 10, outputTokens: 5 },
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: null, outputTokens: null },
      { inputTokens: null, outputTokens: 5 },
      { inputTokens: 10, outputTokens: null },
    ];
    for (const counts of expected) {
      const accepted = await repository.submit(submission(), limits);
      const result = await repository.finish(reference(accepted), {
        ...completed,
        usage: counts,
      });
      expect(result).toMatchObject(counts);
    }
    const client = await connection.pool.connect();
    try {
      await client.query('begin');
      // Recreate the previous JSON representation with existing attempt data.
      await client.query(
        'alter table conversation_attempts add column usage jsonb',
      );
      await client.query(`update conversation_attempts set usage = case
        when input_tokens is null and output_tokens is null then null
        else jsonb_build_object('inputTokens', input_tokens, 'outputTokens', output_tokens) end`);
      await client.query(
        'alter table conversation_attempts drop column input_tokens, drop column output_tokens',
      );
      const migration = await readFile(
        new URL(
          '../../packages/backend/drizzle/0006_attempt_token_columns.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await client.query(migration);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    const history = await repository.history(ownerId);
    expect(
      history.turns.map((turn) => ({
        inputTokens: turn.attempts[0]?.inputTokens,
        outputTokens: turn.attempts[0]?.outputTokens,
      })),
    ).toEqual(expected);
    const attemptId = history.turns[0]?.attempts[0]?.id;
    for (const column of ['input_tokens', 'output_tokens']) {
      // Column names are fixed test constants; values remain parameterized.
      await expect(
        connection.pool.query(
          `update conversation_attempts set ${column}=-1 where id=$1`,
          [attemptId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    const columns = await connection.pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='conversation_attempts'",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('usage');
  });

  it('removes investigation and digest columns while preserving existing submissions', async () => {
    const input = submission({ text: 'A notice with Unicode: 🌱' });
    const accepted = await repository.submit(input, limits);
    const client = await connection.pool.connect();
    try {
      await client.query('begin');
      // Recreate the previous columns to exercise an upgrade
      // with existing content, in addition to the fresh-migration runner.
      await client.query(
        'alter table conversation_turns add column investigate boolean not null default false',
      );
      await client.query(
        "alter table conversation_turns add column input_digest text not null default 'legacy-digest'",
      );
      const migration = await readFile(
        new URL(
          '../../packages/backend/drizzle/0004_remove_turn_investigation.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await client.query(migration);
      const removeDigest = await readFile(
        new URL(
          '../../packages/backend/drizzle/0005_remove_turn_input_digest.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await client.query(removeDigest);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    const columns = await connection.pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'conversation_turns'",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain(
      'investigate',
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain(
      'input_digest',
    );
    const replay = await repository.submit(input, limits);
    expect(replay.execute).toBe(false);
    expect(replay.attempt.id).toBe(accepted.attempt.id);
    expect(replay.turn.text).toBe(input.text);
  });

  it('enforces one conversation per owner and rejects unknown owners', async () => {
    await connection.db.insert(conversations).values({ ownerId });
    await expect(
      connection.pool.query(
        'insert into conversations (owner_id) values ($1)',
        [ownerId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      connection.pool.query(
        'insert into conversations (owner_id) values ($1)',
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('enforces turn order and submission keys independently', async () => {
    const { conversation, turn } = await seedTurn();
    const insert =
      'insert into conversation_turns (conversation_id, request_id, sequence, text) values ($1, $2, $3, $4)';
    await expect(
      connection.pool.query(insert, [
        conversation.id,
        turn.requestId,
        2,
        'other',
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      connection.pool.query(insert, [
        conversation.id,
        randomUUID(),
        1,
        'other',
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces one active attempt, valid outcomes, and turn foreign keys', async () => {
    const { conversation, turn } = await seedTurn();
    const now = new Date();
    const values = {
      conversationId: conversation.id,
      turnId: turn.id,
      requestId: randomUUID(),
      model: 'synthetic-model',
      state: 'running' as const,
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 60_000),
    };
    await connection.db.insert(conversationAttempts).values(values);
    const insert =
      'insert into conversation_attempts (conversation_id, turn_id, request_id, model, state, started_at, deadline_at, attempt_number) values ($1, $2, $3, $4, $5, $6, $7, 2)';
    await expect(
      connection.pool.query(insert, [
        conversation.id,
        turn.id,
        randomUUID(),
        'fake',
        'running',
        now,
        values.deadlineAt,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      connection.pool.query(insert, [
        conversation.id,
        turn.id,
        randomUUID(),
        'fake',
        'completed',
        now,
        values.deadlineAt,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await connection.pool.query('delete from conversation_attempts');
    await expect(
      connection.pool.query(insert, [
        conversation.id,
        randomUUID(),
        randomUUID(),
        'fake',
        'running',
        now,
        values.deadlineAt,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('cascades turn deletion to results and owner deletion to the conversation', async () => {
    const { conversation, turn } = await seedTurn();
    const now = new Date();
    await connection.db.insert(conversationAttempts).values({
      conversationId: conversation.id,
      turnId: turn.id,
      requestId: randomUUID(),
      model: 'fake',
      state: 'completed',
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 60_000),
      finishedAt: now,
      answer: 'Synthetic answer',
      sources: [{ title: 'Example', url: 'https://example.test' }],
      activity: [{ type: 'web_search', status: 'completed' }],
    });
    await connection.pool.query('delete from conversation_turns');
    expect(await connection.db.select().from(conversationAttempts)).toEqual([]);
    expect(await connection.db.select().from(conversations)).toHaveLength(1);
    await connection.pool.query('delete from owners');
    expect(await connection.db.select().from(conversations)).toEqual([]);
  });
});

const repository = new DrizzleConversationRepository(connection.db);
const limits: RunLimits = {
  model: 'synthetic-model',
  allowedTools: ['web_search'],
  deadlineMs: 60_000,
  maxMessageBytes: 8192,
  maxContextBytes: 32768,
  maxOutputTokens: 2048,
  maxToolCalls: 2,
};
const completed: Extract<RunOutcome, { state: 'completed' }> = {
  state: 'completed',
  answer: 'A synthetic response.',
  sources: [],
  activity: [],
  usage: { inputTokens: 10, outputTokens: 5 },
  contextLimited: false,
};
function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    ownerId,
    historyVersion: 0,
    requestId: randomUUID(),
    text: 'Discuss this synthetic notice.',
    ...overrides,
  };
}
function reference(admission: Admission) {
  return {
    ownerId,
    historyVersion: admission.historyVersion,
    attemptId: admission.attempt.id,
  };
}
async function expire(admission: Admission) {
  await connection.pool.query(
    "update conversation_attempts set started_at=clock_timestamp()-interval '2 seconds', deadline_at=clock_timestamp()-interval '1 second' where id=$1",
    [admission.attempt.id],
  );
}

describe('singleton conversation lifecycle', () => {
  it('reads an empty transcript without creating a conversation and filters unknown owners', async () => {
    expect(await repository.history(ownerId)).toEqual({
      historyVersion: 0,
      turns: [],
      nextCursor: null,
    });
    expect(await connection.db.select().from(conversations)).toEqual([]);
    await expect(repository.history(randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns application models across admission, replay, retry, completion and history', async () => {
    const input = submission();
    const accepted = await repository.submit(input, limits);
    const replay = await repository.submit(input, limits);
    const failed = await repository.finish(reference(accepted), {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    const unchanged = await repository.finish(reference(accepted), completed);
    const retryInput = {
      ownerId,
      historyVersion: 0,
      turnId: accepted.turn.id,
      requestId: randomUUID(),
    };
    const retry = await repository.retry(retryInput, limits);
    const retryReplay = await repository.retry(retryInput, limits);
    const finished = await repository.finish(reference(retry), completed);
    const next = await repository.submit(submission(), limits);
    expect(
      await repository.context(reference(next), next.turn.sequence),
    ).toEqual([{ text: input.text, answer: completed.answer }]);
    await expire(next);
    const interrupted = await repository.finish(reference(next), completed);
    const history = await repository.history(ownerId);

    for (const turn of [
      accepted.turn,
      replay.turn,
      retry.turn,
      retryReplay.turn,
      next.turn,
    ]) {
      expect(turn).not.toHaveProperty('conversationId');
    }
    for (const turn of history.turns) {
      expect(turn).not.toHaveProperty('conversationId');
      for (const attempt of turn.attempts)
        expect(attempt).not.toHaveProperty('conversationId');
    }
    for (const attempt of [
      accepted.attempt,
      replay.attempt,
      failed,
      unchanged,
      retry.attempt,
      retryReplay.attempt,
      finished,
      interrupted,
    ]) {
      expect(attempt).not.toBeNull();
      expect(attempt).not.toHaveProperty('conversationId');
    }
    expect(accepted.attempt).toMatchObject({
      state: 'running',
      finishedAt: null,
      answer: null,
      errorCode: null,
    });
    expect(failed).toMatchObject({
      state: 'failed',
      finishedAt: expect.any(Date),
      answer: null,
      errorCode: 'PROVIDER_ERROR',
    });
    expect(unchanged).toEqual(failed);
    expect(finished).toMatchObject({
      state: 'completed',
      finishedAt: expect.any(Date),
      answer: completed.answer,
      errorCode: null,
    });
    expect(interrupted).toMatchObject({
      state: 'interrupted',
      finishedAt: expect.any(Date),
      answer: null,
      errorCode: 'INTERRUPTED',
    });
  });

  it('rejects an unrecognized stored error code without exposing its contents', async () => {
    const input = submission();
    const accepted = await repository.submit(input, limits);
    // The existing outcome constraint requires a code but does not enumerate it.
    await connection.pool.query(
      "update conversation_attempts set state='failed', finished_at=clock_timestamp(), error_code=$1 where id=$2",
      ['private stored diagnostic', accepted.attempt.id],
    );
    await Promise.all(
      [
        repository.history(ownerId),
        repository.submit(input, limits),
        repository.finish(reference(accepted), completed),
      ].map((result) =>
        expect(result).rejects.toThrow(
          new Error('Invalid stored conversation record'),
        ),
      ),
    );
  });

  it('admits concurrent first-use once and keeps a single conversation and attempt', async () => {
    const input = submission();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => repository.submit(input, limits)),
    );
    expect(results.filter((result) => result.execute)).toHaveLength(1);
    expect(new Set(results.map((result) => result.attempt.id)).size).toBe(1);
    expect(await connection.db.select().from(conversations)).toHaveLength(1);
    expect(await connection.db.select().from(conversationTurns)).toHaveLength(
      1,
    );
    expect(
      await connection.db.select().from(conversationAttempts),
    ).toHaveLength(1);
  });

  it('rejects competing messages while running', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => repository.submit(submission(), limits)),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'BUSY' });
    expect(
      await connection.db.select().from(conversationAttempts),
    ).toHaveLength(1);
  });

  it('rejects key reuse with changed text', async () => {
    const input = submission();
    await repository.submit(input, limits);
    await expect(
      repository.submit({ ...input, text: 'Other' }, limits),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    // Tool permissions belong to runtime policy and do not change submission identity.
    expect(
      (await repository.submit(input, { ...limits, allowedTools: [] })).execute,
    ).toBe(false);
  });

  it('continues the same ordered conversation and exposes only completed pairs as context', async () => {
    const first = await repository.submit(submission(), limits);
    await repository.finish(reference(first), completed);
    const second = await repository.submit(
      submission({ text: 'A different topic later.' }),
      limits,
    );
    await repository.finish(reference(second), {
      state: 'failed',
      errorCode: 'REFUSED',
    });
    const third = await repository.submit(
      submission({ text: 'Continue.' }),
      limits,
    );
    expect(third.turn.sequence).toBe(3);
    expect(
      await repository.context(reference(third), third.turn.sequence),
    ).toEqual([{ text: first.turn.text, answer: 'A synthetic response.' }]);
    expect(await connection.db.select().from(conversations)).toHaveLength(1);
    const restored = await new DrizzleConversationRepository(
      connection.db,
    ).history(ownerId);
    expect(restored.turns.map((turn) => turn.sequence)).toEqual([1, 2, 3]);
    expect(restored.turns.map((turn) => turn.attempts[0]?.state)).toEqual([
      'completed',
      'failed',
      'running',
    ]);
  });

  it('returns chronological pages without deleting messages outside the page', async () => {
    for (let i = 0; i < 4; i++) {
      const accepted = await repository.submit(submission(), limits);
      await repository.finish(reference(accepted), completed);
    }
    const newest = await repository.history(ownerId, { limit: 2 });
    expect(newest.turns.map((turn) => turn.sequence)).toEqual([3, 4]);
    if (!newest.nextCursor) throw new Error('Expected older history');
    const older = await repository.history(ownerId, {
      limit: 2,
      cursor: newest.nextCursor,
    });
    expect(older.turns.map((turn) => turn.sequence)).toEqual([1, 2]);
    expect(older.nextCursor).toBeNull();
    await expect(
      repository.history(ownerId, { limit: 101 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it.each<RunOutcome>([
    { state: 'failed', errorCode: 'PROVIDER_ERROR' },
    {
      state: 'failed',
      errorCode: 'RATE_LIMITED',
      usage: { inputTokens: 11, outputTokens: 7 },
    },
    {
      state: 'failed',
      errorCode: 'INVALID_RESPONSE',
      usage: { inputTokens: 0, outputTokens: 0 },
    },
    {
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
      usage: { inputTokens: 11, outputTokens: null },
    },
    {
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
      usage: { inputTokens: null, outputTokens: 7 },
    },
  ])(
    'retains supplied unsuccessful usage and leaves terminal metadata unchanged: %j',
    async (outcome) => {
      const accepted = await repository.submit(submission(), limits);
      const finished = await repository.finish(reference(accepted), outcome);
      expect(finished).toMatchObject({
        state: outcome.state,
        inputTokens: outcome.usage?.inputTokens ?? null,
        outputTokens: outcome.usage?.outputTokens ?? null,
        answer: null,
      });
      expect((await repository.history(ownerId)).turns[0]?.attempts[0]).toEqual(
        finished,
      );
      expect(await repository.finish(reference(accepted), completed)).toEqual(
        finished,
      );
    },
  );

  it('terminalizes expired attempts and refuses late or repeated completion', async () => {
    const accepted = await repository.submit(submission(), limits);
    await expire(accepted);
    expect(
      (await repository.history(ownerId)).turns[0]?.attempts[0]?.state,
    ).toBe('interrupted');
    expect(
      (await repository.finish(reference(accepted), completed))?.state,
    ).toBe('interrupted');
    const retry = await repository.retry(
      {
        ownerId,
        historyVersion: 0,
        turnId: accepted.turn.id,
        requestId: randomUUID(),
      },
      limits,
    );
    await repository.finish(reference(retry), completed);
    const result = await repository.finish(reference(retry), {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    expect(result?.state).toBe('completed');
    expect(result?.answer).toBe('A synthetic response.');
  });

  it('retries only the latest unsuccessful turn, once per retry key', async () => {
    const accepted = await repository.submit(submission(), limits);
    await expect(
      repository.retry(
        {
          ownerId,
          historyVersion: 0,
          turnId: accepted.turn.id,
          requestId: randomUUID(),
        },
        limits,
      ),
    ).rejects.toMatchObject({ code: 'NOT_RETRYABLE' });
    await repository.finish(reference(accepted), {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    const input = {
      ownerId,
      historyVersion: 0,
      turnId: accepted.turn.id,
      requestId: randomUUID(),
    };
    const results = await Promise.all(
      Array.from({ length: 3 }, () => repository.retry(input, limits)),
    );
    expect(results.filter((result) => result.execute)).toHaveLength(1);
    expect(results[0]?.attempt.attemptNumber).toBe(2);
    expect(await connection.db.select().from(conversationTurns)).toHaveLength(
      1,
    );
    await repository.finish(reference(results[0]!), {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    const newer = await repository.submit(submission(), limits);
    await repository.finish(reference(newer), completed);
    for (const turnId of [accepted.turn.id, newer.turn.id]) {
      await expect(
        repository.retry(
          { ownerId, historyVersion: 0, turnId, requestId: randomUUID() },
          limits,
        ),
      ).rejects.toMatchObject({ code: 'NOT_RETRYABLE' });
    }
    await expect(
      repository.retry(
        {
          ownerId,
          historyVersion: 0,
          turnId: randomUUID(),
          requestId: randomUUID(),
        },
        limits,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps submission and retry keys distinct while replaying older accepted work', async () => {
    const input = submission();
    const accepted = await repository.submit(input, limits);
    const failure: RunOutcome = {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    };
    await repository.finish(reference(accepted), failure);
    const retryInput = {
      ownerId,
      historyVersion: 0,
      turnId: accepted.turn.id,
      requestId: randomUUID(),
    };
    const retried = await repository.retry(retryInput, limits);
    await repository.finish(reference(retried), failure);
    const newer = await repository.submit(submission(), limits);

    expect(await repository.submit(input, limits)).toMatchObject({
      execute: false,
      turn: { id: accepted.turn.id },
      attempt: { id: retried.attempt.id },
    });
    expect(await repository.retry(retryInput, limits)).toMatchObject({
      execute: false,
      attempt: { id: retried.attempt.id },
    });
    await Promise.all(
      [
        repository.submit(
          submission({ requestId: retryInput.requestId }),
          limits,
        ),
        repository.retry({ ...retryInput, requestId: input.requestId }, limits),
        repository.retry({ ...retryInput, turnId: newer.turn.id }, limits),
      ].map((request) =>
        expect(request).rejects.toMatchObject({
          code: 'IDEMPOTENCY_CONFLICT',
        }),
      ),
    );
    expect(await connection.db.select().from(conversationTurns)).toHaveLength(
      2,
    );
    expect(
      await connection.db.select().from(conversationAttempts),
    ).toHaveLength(3);
  });

  it('admits only one competing fresh retry key', async () => {
    const accepted = await repository.submit(submission(), limits);
    await repository.finish(reference(accepted), {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        repository.retry(
          {
            ownerId,
            historyVersion: 0,
            turnId: accepted.turn.id,
            requestId: randomUUID(),
          },
          limits,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'NOT_RETRYABLE' });
    }
    const attempts = await connection.db.select().from(conversationAttempts);
    expect(attempts).toHaveLength(2);
    expect(
      attempts.filter((attempt) => attempt.state === 'running'),
    ).toHaveLength(1);
  });

  it('accepts sequential attempts without a daily counter, including after clearing and restart', async () => {
    for (let index = 0; index < 25; index++) {
      const accepted = await repository.submit(submission(), limits);
      expect(accepted.execute).toBe(true);
      await repository.finish(reference(accepted), {
        state: 'failed',
        errorCode: 'PROVIDER_ERROR',
      });
    }
    await repository.clear(ownerId, 0);
    const accepted = await new DrizzleConversationRepository(
      connection.db,
    ).submit(submission({ historyVersion: 1 }), limits);
    expect(accepted.execute).toBe(true);
    const result = await connection.pool.query<{ table_name: string | null }>(
      "select to_regclass('public.assistant_daily_admissions')::text as table_name",
    );
    expect(result.rows[0]?.table_name).toBeNull();
  });

  it('clears history without replacing the singleton or admitting stale tabs', async () => {
    const input = submission();
    const accepted = await repository.submit(input, limits);
    const [before] = await connection.db.select().from(conversations);
    expect(await repository.clear(ownerId, 0)).toBe(1);
    expect(await repository.finish(reference(accepted), completed)).toBeNull();
    const fresh = await repository.submit(
      submission({ historyVersion: 1, text: 'Keep this new message.' }),
      limits,
    );
    await Promise.all(
      [
        repository.submit(input, limits),
        repository.retry(
          {
            ownerId,
            historyVersion: 0,
            turnId: accepted.turn.id,
            requestId: randomUUID(),
          },
          limits,
        ),
        repository.clear(ownerId, 0),
        repository.history(ownerId, {
          cursor: { historyVersion: 0, beforeSequence: 2 },
        }),
      ].map((stale) =>
        expect(stale).rejects.toMatchObject({ code: 'STALE_HISTORY' }),
      ),
    );
    const restored = await repository.history(ownerId);
    expect(restored.turns.map((turn) => turn.text)).toEqual([
      'Keep this new message.',
    ]);
    expect(fresh.turn.sequence).toBe(1);
    expect((await connection.db.select().from(conversations))[0]?.id).toBe(
      before?.id,
    );
    expect(
      await connection.db.select().from(conversationAttempts),
    ).toHaveLength(1);
  });

  it('serializes history clearing against completion and retry admission', async () => {
    const accepted = await repository.submit(submission(), limits);
    await Promise.all([
      repository.finish(reference(accepted), completed),
      repository.clear(ownerId, 0),
    ]);
    expect(await repository.history(ownerId)).toEqual({
      historyVersion: 1,
      turns: [],
      nextCursor: null,
    });
    const failed = await repository.submit(
      submission({ historyVersion: 1 }),
      limits,
    );
    await repository.finish(reference(failed), {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    const outcomes = await Promise.allSettled([
      repository.retry(
        {
          ownerId,
          historyVersion: 1,
          turnId: failed.turn.id,
          requestId: randomUUID(),
        },
        limits,
      ),
      repository.clear(ownerId, 1),
    ]);
    expect(outcomes[1]?.status).toBe('fulfilled');
    expect(await repository.history(ownerId)).toEqual({
      historyVersion: 2,
      turns: [],
      nextCursor: null,
    });
  });
});

describe('conversation use case with a fake provider and real persistence', () => {
  it.each<{ name: string; values: NodeJS.ProcessEnv }>([
    { name: 'missing provider settings', values: {} },
    {
      name: 'missing server key',
      values: { OPENAI_CHAT_MODEL: 'synthetic-model' },
    },
    {
      name: 'invalid limits',
      values: {
        OPENAI_API_KEY: 'synthetic-server-key',
        OPENAI_CHAT_MODEL: 'synthetic-model',
        AI_DEADLINE_MS: 'Infinity',
      },
    },
  ])(
    'preserves history and clearing but admits no runs with $name',
    async ({ values }) => {
      const first = await repository.submit(
        submission({ text: 'Retain this accepted message' }),
        limits,
      );
      await repository.finish(reference(first), completed);
      const failed = await repository.submit(
        submission({ text: 'Retain this retryable message' }),
        limits,
      );
      await repository.finish(reference(failed), {
        state: 'failed',
        errorCode: 'PROVIDER_ERROR',
      });
      const before = await repository.history(ownerId);
      const config = readAIEnvironment(values);
      if (config.enabled) throw new Error('Expected disabled fixture');
      const loop = new ConversationLoop(repository, config);
      expect(await loop.history(ownerId)).toEqual(before);
      await expect(submitTurn(loop, submission())).rejects.toMatchObject({
        code: 'EXECUTION_UNAVAILABLE',
      });
      await expect(
        retryTurn(loop, {
          ownerId,
          historyVersion: 0,
          turnId: failed.turn.id,
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'EXECUTION_UNAVAILABLE' });
      expect(await loop.history(ownerId)).toEqual(before);
      expect(await loop.clear(ownerId, { historyVersion: 0 })).toBe(1);
      expect(await loop.history(ownerId)).toEqual({
        historyVersion: 1,
        turns: [],
        nextCursor: null,
      });
    },
  );

  it('bounds completed model context without discarding retained history', async () => {
    const oldestText = 'An older question. '.repeat(50);
    const oldest = await repository.submit(
      submission({ text: oldestText }),
      limits,
    );
    await repository.finish(reference(oldest), completed);
    const failed = await repository.submit(
      submission({ text: 'A failed question' }),
      limits,
    );
    await repository.finish(reference(failed), {
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    const recentText = 'A recent question 🌱';
    const recentAnswer = 'A recent answer with "quotes".';
    const recent = await repository.submit(
      submission({ text: recentText }),
      limits,
    );
    await repository.finish(reference(recent), {
      ...completed,
      answer: recentAnswer,
    });

    const text = 'The current question';
    const messages = [
      { role: 'user', text: recentText },
      { role: 'assistant', text: recentAnswer },
      { role: 'user', text },
    ];
    const complete = vi
      .fn<ConversationModel['complete']>()
      .mockResolvedValue(completed);
    const loop = new ConversationLoop(repository, {
      enabled: true,
      model: { complete },
      limits: {
        ...limits,
        maxMessageBytes: 64,
        maxContextBytes: Buffer.byteLength(JSON.stringify(messages), 'utf8'),
      },
    });
    const result = await submitTurn(loop, submission({ text }));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].messages).toEqual(messages);
    expect(result.attempt).toMatchObject({
      state: 'completed',
      contextLimited: true,
    });
    const history = await loop.history(ownerId);
    expect(history.turns.map((turn) => turn.text)).toEqual([
      oldestText,
      'A failed question',
      recentText,
      text,
    ]);
    expect(history.turns[1]?.attempts[0]?.state).toBe('failed');
    expect(history.turns[3]?.attempts[0]?.contextLimited).toBe(true);
  });

  it('invokes the provider once for competing submissions and stores the final response', async () => {
    let release!: (outcome: RunOutcome) => void;
    const pending = new Promise<RunOutcome>((resolve) => {
      release = resolve;
    });
    const complete = vi
      .fn<ConversationModel['complete']>()
      .mockReturnValue(pending);
    const loop = new ConversationLoop(repository, {
      enabled: true,
      model: { complete },
      limits,
    });
    const input = submission();
    const original = submitTurn(loop, input);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const replay = await submitTurn(loop, input);
    expect(replay.execute).toBe(false);
    expect(replay.attempt.state).toBe('running');
    release(completed);
    expect((await original).attempt.state).toBe('completed');
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await loop.history(ownerId)).turns[0]?.attempts[0]?.answer).toBe(
      'A synthetic response.',
    );
  });

  it('retains a failed attempt and its input, then retries without duplicating the message', async () => {
    const complete = vi
      .fn<ConversationModel['complete']>()
      .mockRejectedValueOnce(new Error('sensitive provider payload'))
      .mockResolvedValueOnce(completed);
    const loop = new ConversationLoop(repository, {
      enabled: true,
      model: { complete },
      limits,
    });
    const first = await submitTurn(loop, submission());
    expect(first.attempt.errorCode).toBe('PROVIDER_ERROR');
    expect(JSON.stringify(first)).not.toContain('sensitive');
    const retry = await retryTurn(loop, {
      ownerId,
      historyVersion: 0,
      turnId: first.turn.id,
      requestId: randomUUID(),
    });
    expect(retry.attempt.state).toBe('completed');
    const history = await loop.history(ownerId);
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0]?.attempts.map((attempt) => attempt.state)).toEqual([
      'failed',
      'completed',
    ]);
  });

  it('aborts locally on history clearing and never restores the cleared input', async () => {
    const complete = vi
      .fn<ConversationModel['complete']>()
      .mockImplementation(() => new Promise(() => {}));
    const loop = new ConversationLoop(repository, {
      enabled: true,
      model: { complete },
      limits,
    });
    // Register rejection handling before clearing, avoiding an unhandled rejection.
    const original = submitTurn(loop, submission()).then(
      (value) => value,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await loop.clear(ownerId, { historyVersion: 0 });
    expect(await original).toMatchObject({ code: 'STALE_HISTORY' });
    expect(complete.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(await loop.history(ownerId)).toEqual({
      historyVersion: 1,
      turns: [],
      nextCursor: null,
    });
  });
});
