import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { getGlobalTraceProvider, tool } from '@openai/agents';
import OpenAI from 'openai';
import { createDatabase, migrateDatabase } from '@mentor/backend/database';
import { readDatabaseEnvironment } from '@mentor/backend/config';
import { readAIEnvironment } from '@mentor/backend/config/ai';
import { owners } from '@mentor/backend/identity/schema';
import { ConversationLoop } from '@mentor/backend/conversation';
import type {
  ConversationModel,
  RunOutcome,
  Submission,
} from '@mentor/backend/conversation';
import { DrizzleConversationRepository } from '@mentor/backend/conversation/persistence';
import { executeSDKConversation } from '@mentor/backend/conversation/model';
import {
  conversationAttempts,
  conversationTurns,
} from '@mentor/backend/conversation/schema';
import { createConversationLoop } from '../../apps/api/src/conversation/infrastructure/conversation.module.js';
import {
  createResponsesStub,
  response,
  toolResponse,
} from '../fixtures/responses-stub.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test') {
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
}
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const configuration = readAIEnvironment({
  OPENAI_API_KEY: 'synthetic-test-key',
  OPENAI_CHAT_MODEL: 'test-model',
  AI_DEADLINE_MS: '5000',
});
if (!configuration.enabled) throw new Error('Invalid synthetic configuration');
const limits = configuration.limits;
const repository = new DrizzleConversationRepository(connection.db);
let stub: Awaited<ReturnType<typeof createResponsesStub>>;
let ownerId: string;

function compose(values = configuration) {
  return createConversationLoop(connection.db, values, {
    baseURL: stub.baseURL,
  });
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    ownerId,
    historyVersion: 0,
    requestId: randomUUID(),
    text: 'A synthetic question',
    ...overrides,
  };
}

function syntheticTool(execute: () => Promise<string>) {
  return tool({
    name: 'synthetic_step',
    description: 'Local integration test only',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    execute,
  });
}

function withTestTool(execute: () => Promise<string>) {
  const client = new OpenAI({
    apiKey: 'synthetic-test-key',
    baseURL: stub.baseURL,
    maxRetries: 0,
    logLevel: 'off',
  });
  const step = syntheticTool(execute);
  let run: Promise<RunOutcome> | undefined;
  const model: ConversationModel = {
    complete(input) {
      run = executeSDKConversation(client, input, [step]);
      return run;
    },
  };
  return {
    loop: new ConversationLoop(repository, { enabled: true, model, limits }),
    result: () => run,
  };
}

beforeAll(async () => {
  await migrateDatabase(connection);
  stub = await createResponsesStub();
});
beforeEach(async () => {
  stub.reset();
  await connection.pool.query('truncate owners, login_throttle cascade');
  const [owner] = await connection.db
    .insert(owners)
    .values({
      email: 'sdk@example.test',
      passwordHash: 'synthetic-unused-hash',
    })
    .returning();
  if (!owner) throw new Error('Test owner missing');
  ownerId = owner.id;
});
afterEach(async () => {
  await getGlobalTraceProvider().forceFlush();
  expect(stub.unexpectedTraffic).toEqual([]);
});
afterAll(async () => {
  try {
    if (stub) {
      await getGlobalTraceProvider().shutdown();
      expect(stub.unexpectedTraffic).toEqual([]);
    }
  } finally {
    if (stub) await stub.close();
    await connection.pool.end();
  }
});

describe('composed conversation use case, real SDK, and PostgreSQL', () => {
  it('starts no work at composition and rebuilds follow-up context from persisted answers', async () => {
    const loop = compose();
    expect(stub.requests).toHaveLength(0);
    stub.enqueue(response('We discussed gardens.'));
    const first = await loop.submit(
      submission({ text: 'Let us discuss gardens.' }),
    );
    expect(first.attempt).toMatchObject({
      state: 'completed',
      answer: 'We discussed gardens.',
      inputTokens: 11,
      outputTokens: 7,
    });
    stub.enqueue(response('A contextual follow-up'));
    await compose().submit(submission({ text: 'What were we discussing?' }));
    expect(stub.requests).toHaveLength(2);
    const request = stub.requests[1]!.body;
    expect(JSON.stringify(request.input)).toContain('We discussed gardens.');
    expect(request).toMatchObject({
      model: 'test-model',
      store: false,
      max_output_tokens: limits.maxOutputTokens,
    });
    expect(request.tools ?? []).toEqual([]);
    expect(request).not.toHaveProperty('previous_response_id');
    expect(request).not.toHaveProperty('conversation');
    expect((await loop.history(ownerId)).turns).toHaveLength(2);
    const [stored] = await connection.db.select().from(conversationAttempts);
    expect(stored).toMatchObject({ inputTokens: 11, outputTokens: 7 });
    expect(stored).not.toHaveProperty('runState');
  });

  it('uses database admission across instances to reject competing runs and replay without another runner', async () => {
    const loop = compose();
    const other = compose();
    const input = submission();
    let held!: ServerResponse;
    stub.replies.push((res) => {
      held = res;
    });
    const original = loop.submit(input);
    try {
      await vi.waitFor(() => expect(stub.requests).toHaveLength(1));
      const replays = await Promise.all(
        Array.from({ length: 4 }, () => other.submit(input)),
      );
      expect(
        replays.every(
          (replay) => !replay.execute && replay.attempt.state === 'running',
        ),
      ).toBe(true);
      await expect(other.submit(submission())).rejects.toMatchObject({
        code: 'BUSY',
      });
      await expect(
        other.submit({ ...input, text: 'Changed payload' }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(stub.requests).toHaveLength(1);
    } finally {
      held
        ?.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(response()));
      await original;
    }
    expect((await other.submit(input)).attempt.state).toBe('completed');
    expect(stub.requests).toHaveLength(1);
    expect(await connection.db.select().from(conversationTurns)).toHaveLength(
      1,
    );
    expect(
      await connection.db.select().from(conversationAttempts),
    ).toHaveLength(1);
  });

  it('keeps provider failures redacted and starts a fresh run only for an explicit retry key', async () => {
    const loop = compose();
    const input = submission();
    stub.enqueue(
      { error: { message: 'PRIVATE synthetic-test-key', type: 'api_error' } },
      503,
    );
    const first = await loop.submit(input);
    expect(first.attempt).toMatchObject({
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
      answer: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect((await loop.submit(input)).execute).toBe(false);
    expect(stub.requests).toHaveLength(1);
    stub.enqueue(response('Retried answer'));
    const retryInput = {
      ownerId,
      historyVersion: 0,
      turnId: first.turn.id,
      requestId: randomUUID(),
    };
    const retry = await loop.retry(retryInput);
    expect(retry.attempt).toMatchObject({
      state: 'completed',
      attemptNumber: 2,
    });
    expect(retry.attempt.id).not.toBe(first.attempt.id);
    expect((await loop.retry(retryInput)).execute).toBe(false);
    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[1]!.body).not.toHaveProperty('previous_response_id');
    expect(stub.requests[1]!.body.input).toHaveLength(1);
    const history = await loop.history(ownerId);
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0]?.attempts.map((attempt) => attempt.state)).toEqual([
      'failed',
      'completed',
    ]);
    expect(JSON.stringify(history)).not.toContain('PRIVATE');
    expect(JSON.stringify(history)).not.toContain('synthetic-test-key');
  });

  it('reconciles orphaned attempts after restart without resuming provider work', async () => {
    const input = submission();
    const orphan = await repository.submit(input, limits);
    const restored = compose();
    expect((await restored.history(ownerId)).turns[0]?.attempts[0]?.state).toBe(
      'running',
    );
    expect((await restored.submit(input)).execute).toBe(false);
    expect(stub.requests).toHaveLength(0);
    await connection.pool.query(
      "update conversation_attempts set started_at = clock_timestamp() - interval '2 minutes', deadline_at = clock_timestamp() - interval '1 minute' where id = $1",
      [orphan.attempt.id],
    );
    expect(
      (await compose().history(ownerId)).turns[0]?.attempts[0],
    ).toMatchObject({
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
      inputTokens: null,
      outputTokens: null,
    });
    expect((await restored.submit(input)).execute).toBe(false);
    expect(stub.requests).toHaveLength(0);
    stub.enqueue(response('Fresh run after restart'));
    const retry = await restored.retry({
      ownerId,
      historyVersion: 0,
      turnId: orphan.turn.id,
      requestId: randomUUID(),
    });
    expect(retry.attempt).toMatchObject({
      state: 'completed',
      attemptNumber: 2,
    });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.body.input).toHaveLength(1);
  });

  it('cancels an actual pending SDK request at the application deadline without retrying', async () => {
    const short = readAIEnvironment({
      OPENAI_API_KEY: 'synthetic-test-key',
      OPENAI_CHAT_MODEL: 'test-model',
      AI_DEADLINE_MS: '200',
    });
    const loop = compose(short);
    let closed!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      closed = resolve;
    });
    stub.replies.push((res) => {
      res.once('close', closed);
    });
    const result = await loop.submit(submission());
    expect(result.attempt).toMatchObject({
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
      answer: null,
      inputTokens: null,
      outputTokens: null,
    });
    await cancelled;
    expect(stub.requests).toHaveLength(1);
    expect((await loop.history(ownerId)).turns[0]?.attempts[0]).toEqual(
      result.attempt,
    );
  });

  it('rejects invalid, unknown-owner, and non-retryable work before another SDK call', async () => {
    const loop = compose();
    await expect(loop.submit(submission({ text: ' ' }))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      loop.submit(submission({ ownerId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(stub.requests).toHaveLength(0);
    stub.enqueue(response());
    const result = await loop.submit(submission());
    await expect(
      loop.retry({
        ownerId,
        historyVersion: 0,
        turnId: result.turn.id,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_RETRYABLE' });
    expect(stub.requests).toHaveLength(1);
  });

  it('retains SDK-normalized zero counts when the provider omits usage', async () => {
    const loop = compose();
    stub.enqueue({ ...response(), usage: undefined });
    const result = await loop.submit(submission());
    expect(result.attempt).toMatchObject({
      state: 'completed',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect((await loop.history(ownerId)).turns[0]?.attempts[0]).toEqual(
      result.attempt,
    );
  });

  it.each([
    { name: 'missing key and model', values: {} },
    { name: 'missing key', values: { OPENAI_CHAT_MODEL: 'test-model' } },
    {
      name: 'invalid deadline',
      values: {
        OPENAI_API_KEY: 'synthetic-test-key',
        OPENAI_CHAT_MODEL: 'test-model',
        AI_DEADLINE_MS: 'Infinity',
      },
    },
  ])(
    'keeps history readable and clearable with $name, without admitting SDK work',
    async ({ values }) => {
      stub.enqueue(response('Retained answer'));
      await compose().submit(submission());
      const failed = await repository.submit(submission(), limits);
      await repository.finish(
        { ownerId, historyVersion: 0, attemptId: failed.attempt.id },
        { state: 'failed', errorCode: 'PROVIDER_ERROR' },
      );
      const before = await repository.history(ownerId);
      const disabled = createConversationLoop(
        connection.db,
        readAIEnvironment(values),
        { baseURL: stub.baseURL },
      );
      expect(await disabled.history(ownerId)).toEqual(before);
      await expect(disabled.submit(submission())).rejects.toMatchObject({
        code: 'EXECUTION_UNAVAILABLE',
      });
      await expect(
        disabled.retry({
          ownerId,
          historyVersion: 0,
          turnId: failed.turn.id,
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'EXECUTION_UNAVAILABLE' });
      expect(await disabled.history(ownerId)).toEqual(before);
      expect(stub.requests).toHaveLength(1);
      expect(await disabled.clear(ownerId, 0)).toBe(1);
      expect((await disabled.history(ownerId)).turns).toEqual([]);
    },
  );

  it.each([
    {
      name: 'rate limit',
      body: { error: { message: 'PRIVATE', type: 'api_error' } },
      status: 429,
      code: 'RATE_LIMITED',
      usage: null,
    },
    {
      name: 'incomplete',
      body: { ...response('PRIVATE partial'), status: 'incomplete' },
      status: 200,
      code: 'INCOMPLETE',
      usage: { inputTokens: 11, outputTokens: 7 },
    },
    {
      name: 'invalid answer',
      body: response('   '),
      status: 200,
      code: 'INVALID_RESPONSE',
      usage: { inputTokens: 11, outputTokens: 7 },
    },
    {
      name: 'refusal',
      body: {
        ...response(),
        output: [
          {
            type: 'message',
            id: 'msg_stub',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'PRIVATE refusal' }],
          },
        ],
      },
      status: 200,
      code: 'REFUSED',
      usage: { inputTokens: 11, outputTokens: 7 },
    },
  ])(
    'persists stable failure and available SDK usage for $name',
    async ({ body, status, code, usage }) => {
      const loop = compose();
      stub.enqueue(body, status);
      const result = await loop.submit(submission());
      expect(result.attempt).toMatchObject({
        state: 'failed',
        errorCode: code,
        answer: null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      });
      expect((await compose().history(ownerId)).turns[0]?.attempts[0]).toEqual(
        result.attempt,
      );
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(stub.requests).toHaveLength(1);
    },
  );

  it('persists aggregate SDK usage for several steps within one attempt', async () => {
    const { loop } = withTestTool(async () => 'Synthetic evidence');
    stub.enqueue(toolResponse(70));
    stub.enqueue(response('Final answer', 60));
    const result = await loop.submit(submission());
    expect(result.attempt).toMatchObject({
      state: 'completed',
      inputTokens: 22,
      outputTokens: 130,
    });
    expect((await compose().history(ownerId)).turns[0]?.attempts[0]).toEqual(
      result.attempt,
    );
    expect(
      await connection.db.select().from(conversationAttempts),
    ).toHaveLength(1);
    expect(stub.requests).toHaveLength(2);
  });

  it('preserves SDK usage after a later provider failure and retries with fresh application context', async () => {
    const { loop } = withTestTool(async () => 'Synthetic evidence');
    stub.enqueue(toolResponse(9));
    stub.enqueue({ error: { message: 'PRIVATE', type: 'api_error' } }, 429);
    const result = await loop.submit(submission());
    expect(result.attempt).toMatchObject({
      state: 'failed',
      errorCode: 'RATE_LIMITED',
      inputTokens: 11,
      outputTokens: 9,
    });
    expect((await compose().history(ownerId)).turns[0]?.attempts[0]).toEqual(
      result.attempt,
    );
    expect(stub.requests).toHaveLength(2);
    stub.enqueue(response('Fresh retry answer'));
    const retry = await compose().retry({
      ownerId,
      historyVersion: 0,
      turnId: result.turn.id,
      requestId: randomUUID(),
    });
    expect(retry.attempt).toMatchObject({
      state: 'completed',
      attemptNumber: 2,
      inputTokens: 11,
      outputTokens: 7,
    });
    expect(stub.requests).toHaveLength(3);
    expect(stub.requests[2]!.body.input).toHaveLength(1);
    expect(stub.requests[2]!.body.tools ?? []).toEqual([]);
    expect(stub.requests[2]!.body).not.toHaveProperty('previous_response_id');
  });

  it('persists SDK iteration-limit usage without publishing intermediate output', async () => {
    const { loop } = withTestTool(async () => 'Synthetic evidence');
    for (let step = 1; step <= 10; step++)
      stub.enqueue(toolResponse(7, [], step));
    const result = await loop.submit(submission());
    expect(result.attempt).toMatchObject({
      state: 'failed',
      errorCode: 'LIMIT_EXCEEDED',
      answer: null,
      inputTokens: 110,
      outputTokens: 70,
    });
    expect((await compose().history(ownerId)).turns[0]?.attempts[0]).toEqual(
      result.attempt,
    );
    expect(stub.requests).toHaveLength(10);
  });

  it('clears between SDK steps, aborts continuation, and protects new history from late completion', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const test = withTestTool(async () => {
      entered();
      await gate;
      return 'PRIVATE old intermediate';
    });
    const oldInput = submission();
    stub.enqueue(toolResponse());
    const original = test.loop.submit(oldInput).then(
      (value) => value,
      (error: unknown) => error,
    );
    try {
      await started;
      expect(await test.loop.clear(ownerId, 0)).toBe(1);
      expect(await original).toMatchObject({ code: 'STALE_HISTORY' });
      stub.enqueue(response('Only the new answer'));
      await compose().submit(
        submission({ historyVersion: 1, text: 'A new private question' }),
      );
    } finally {
      release();
      expect(await test.result()).toMatchObject({
        state: 'interrupted',
        errorCode: 'INTERRUPTED',
        usage: { inputTokens: 11, outputTokens: 7 },
      });
    }
    const history = await compose().history(ownerId);
    expect(history.historyVersion).toBe(1);
    expect(history.turns.map((turn) => turn.text)).toEqual([
      'A new private question',
    ]);
    expect(JSON.stringify(stub.requests[1]!.body)).not.toContain(
      'PRIVATE old intermediate',
    );
    await expect(test.loop.submit(oldInput)).rejects.toMatchObject({
      code: 'STALE_HISTORY',
    });
    expect(stub.requests).toHaveLength(2);
    expect(
      await connection.db.select().from(conversationAttempts),
    ).toHaveLength(1);
  });

  it('rejects multi-step completion after another API instance clears history without a local abort', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const test = withTestTool(async () => {
      entered();
      await gate;
      return 'Old synthetic evidence';
    });
    stub.enqueue(toolResponse());
    stub.enqueue(response('PRIVATE late final answer'));
    const original = test.loop.submit(submission()).then(
      (value) => value,
      (error: unknown) => error,
    );
    try {
      await started;
      expect(await compose().clear(ownerId, 0)).toBe(1);
    } finally {
      release();
    }
    expect(await original).toMatchObject({ code: 'STALE_HISTORY' });
    expect(await test.result()).toMatchObject({ state: 'completed' });
    expect(stub.requests).toHaveLength(2);
    expect(await compose().history(ownerId)).toEqual({
      historyVersion: 1,
      turns: [],
      nextCursor: null,
    });
    expect(await connection.db.select().from(conversationAttempts)).toEqual([]);
  });
});
