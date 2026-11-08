import { submitTurn, retryTurn } from '../fixtures/conversation-commands.js';
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
  ConversationProgress,
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
  startResponseStream,
  toolResponse,
  citedWebResponse,
  citedAnswer,
  citationMarker,
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
  it.each([false, true])(
    'persists hosted search evidence and the final answer with normal configuration (stream=%s)',
    async (streaming) => {
      const config = readAIEnvironment({
        OPENAI_API_KEY: 'synthetic-test-key',
        OPENAI_CHAT_MODEL: 'test-model',
        AI_MAX_TOOL_CALLS: '3',
      });
      const loop = compose(config);
      const { ownerId: owner, ...command } = submission({
        text: 'What changed in the latest synthetic library release?',
      });
      await expect(
        loop.submit(owner, { ...command, investigation: true }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(stub.requests).toHaveLength(0);
      const answer = citedAnswer;
      if (streaming) {
        stub.replies.push((res) => {
          const stream = startResponseStream(res);
          stream.delta(answer);
          stream.event({
            type: 'response.completed',
            response: citedWebResponse(answer),
          });
          res.end();
        });
      } else {
        stub.enqueue(citedWebResponse(answer));
      }
      const progress: ConversationProgress[] = [];
      const saved = await loop.submit(
        owner,
        command,
        streaming ? (event) => progress.push(event) : undefined,
      );
      expect(saved.attempt).toMatchObject({
        state: 'completed',
        answer,
        inputTokens: 11,
        outputTokens: 7,
        sources: [
          {
            title: 'Synthetic release notes',
            url: 'https://example.test/releases',
            startIndex: citedAnswer.indexOf(citationMarker),
            endIndex: citedAnswer.length,
          },
        ],
        activity: [{ type: 'web_search', status: 'completed' }],
      });
      expect(stub.requests).toHaveLength(1);
      expect(stub.requests[0]!.body).toMatchObject({
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        max_tool_calls: 3,
        store: false,
        stream: streaming,
      });
      if (streaming) {
        expect(progress.map((event) => event.type)).toEqual([
          'accepted',
          'text_delta',
        ]);
      }
      expect((await compose().history(owner)).turns[0]?.attempts[0]).toEqual(
        saved.attempt,
      );
      expect((await compose().submit(owner, command)).attempt).toEqual(
        saved.attempt,
      );
      expect(stub.requests).toHaveLength(1);

      stub.enqueue(response('A follow-up from saved conversation context.'));
      await submitTurn(compose(), submission({ text: 'Explain that change.' }));
      const next = stub.requests[1]!.body;
      expect(next.tools).toEqual([
        expect.objectContaining({ type: 'web_search' }),
      ]);
      expect(next.max_tool_calls).toBe(limits.maxToolCalls);
      expect(JSON.stringify(next.input)).toContain(answer);
      expect(JSON.stringify(next.input)).not.toContain('web_search_call');
      expect(JSON.stringify(next.input)).not.toContain(
        'synthetic library release notes',
      );
      expect(next).not.toHaveProperty('previous_response_id');
      await compose().clear(owner, { historyVersion: 0 });
      expect((await compose().history(owner)).turns).toEqual([]);
    },
  );

  it('applies current search permission to an explicit retry after a search-provider failure', async () => {
    stub.enqueue(
      { error: { message: 'Synthetic failure', type: 'api_error' } },
      503,
    );
    const first = await submitTurn(compose(), submission());
    expect(first.attempt.state).toBe('failed');
    expect(stub.requests[0]!.body.tools).toEqual([
      expect.objectContaining({ type: 'web_search' }),
    ]);
    stub.enqueue(response('Search is unavailable for this retry.'));
    const searchUnavailable = {
      ...configuration,
      limits: { ...limits, allowedTools: [] },
    };
    const retried = await compose(searchUnavailable).retry(
      ownerId,
      first.turn.id,
      {
        historyVersion: 0,
        requestId: randomUUID(),
      },
    );
    expect(retried.turn).toEqual(first.turn);
    expect(retried.attempt).toMatchObject({
      state: 'completed',
      attemptNumber: 2,
    });
    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[1]!.body.tools ?? []).toEqual([]);
    expect(stub.requests[1]!.body).not.toHaveProperty('max_tool_calls');
  });

  it.each(['completed', 'incomplete'] as const)(
    'streams a real SDK retry through %s and replays its persisted attempt without another request',
    async (status) => {
      const loop = compose();
      const input = submission();
      stub.enqueue(
        { error: { message: 'Synthetic failure', type: 'api_error' } },
        503,
      );
      const first = await submitTurn(loop, input);
      expect(first.attempt.state).toBe('failed');
      const command = { historyVersion: 0, requestId: randomUUID() };
      let stream: ReturnType<typeof startResponseStream> | undefined;
      stub.replies.push((res) => {
        stream = startResponseStream(res);
        stream.delta('Retried 🌱');
      });
      const progress: ConversationProgress[] = [];
      const running = loop.retry(ownerId, first.turn.id, command, (event) =>
        progress.push(event),
      );
      try {
        await vi.waitFor(() =>
          expect(progress.some((event) => event.type === 'text_delta')).toBe(
            true,
          ),
        );
        expect(progress[0]).toMatchObject({
          type: 'accepted',
          admission: {
            execute: true,
            turn: first.turn,
            attempt: { requestId: command.requestId, attemptNumber: 2 },
          },
        });
        const history = await compose().history(ownerId);
        expect(history.turns).toHaveLength(1);
        expect(history.turns[0]?.attempts.at(-1)).toMatchObject({
          state: 'running',
          answer: null,
          requestId: command.requestId,
        });
        const replayProgress: ConversationProgress[] = [];
        expect(
          (
            await compose().retry(ownerId, first.turn.id, command, (event) =>
              replayProgress.push(event),
            )
          ).execute,
        ).toBe(false);
        expect(replayProgress).toHaveLength(1);
        expect(replayProgress[0]?.type).toBe('accepted');
        expect(stub.requests).toHaveLength(2);
        expect(stub.requests[1]?.body).toMatchObject({
          stream: true,
          store: false,
        });
      } finally {
        stream?.finish(status);
      }
      const saved = await running;
      expect(saved.turn).toEqual(first.turn);
      expect(saved.attempt).toMatchObject({
        state: status === 'completed' ? 'completed' : 'failed',
        answer: status === 'completed' ? 'Retried 🌱' : null,
        errorCode: status === 'completed' ? null : 'INCOMPLETE',
        requestId: command.requestId,
        inputTokens: 11,
        outputTokens: 7,
      });
      expect(
        (await compose().retry(ownerId, first.turn.id, command, () => {}))
          .attempt,
      ).toEqual(saved.attempt);
      expect(stub.requests).toHaveLength(2);
      expect((await compose().history(ownerId)).turns[0]?.attempts).toEqual([
        first.attempt,
        saved.attempt,
      ]);
      stub.enqueue(response('Follow-up'));
      await submitTurn(compose(), submission({ text: 'Continue' }));
      const nextContext = JSON.stringify(stub.requests[2]?.body.input);
      if (status === 'completed') expect(nextContext).toContain('Retried 🌱');
      else expect(nextContext).not.toContain('Retried');
    },
  );

  it('streams real SDK text before completion, saves usage, and rebuilds follow-up context from the final answer', async () => {
    const loop = compose();
    const { ownerId: owner, ...command } = submission();
    let stream!: ReturnType<typeof startResponseStream>;
    stub.replies.push((res) => {
      stream = startResponseStream(res);
      stream.delta('Growing ');
    });
    const progress: ConversationProgress[] = [];
    const running = loop.submit(owner, command, (event) =>
      progress.push(event),
    );
    try {
      await vi.waitFor(() =>
        expect(progress.some((event) => event.type === 'text_delta')).toBe(
          true,
        ),
      );
      expect(progress[0]).toMatchObject({
        type: 'accepted',
        admission: { execute: true, attempt: { state: 'running' } },
      });
      expect((await loop.history(owner)).turns[0]?.attempts[0]).toMatchObject({
        state: 'running',
        answer: null,
      });
      const replay = await loop.submit(owner, command, () => {});
      expect(replay.execute).toBe(false);
      expect(stub.requests).toHaveLength(1);
      stream.delta('gardens 🌱');
    } finally {
      stream?.finish();
    }
    const saved = await running;
    expect(saved.attempt).toMatchObject({
      state: 'completed',
      answer: 'Growing gardens 🌱',
      inputTokens: 11,
      outputTokens: 7,
    });
    expect((await compose().history(owner)).turns[0]?.attempts[0]).toEqual(
      saved.attempt,
    );
    stub.enqueue(response('Follow-up'));
    await submitTurn(compose(), submission({ text: 'Continue' }));
    expect(JSON.stringify(stub.requests[1]!.body.input)).toContain(
      'Growing gardens 🌱',
    );
  });

  it('saves unsuccessful streaming usage and excludes provisional text from future context', async () => {
    const loop = compose();
    const { ownerId: owner, ...command } = submission();
    stub.replies.push((res) => {
      const stream = startResponseStream(res);
      stream.delta('PRIVATE partial answer');
      stream.finish('incomplete');
    });
    const progress: ConversationProgress[] = [];
    const result = await loop.submit(owner, command, (event) =>
      progress.push(event),
    );
    expect(progress.some((event) => event.type === 'text_delta')).toBe(true);
    expect(result.attempt).toMatchObject({
      state: 'failed',
      errorCode: 'INCOMPLETE',
      answer: null,
      inputTokens: 11,
      outputTokens: 7,
    });
    expect((await compose().history(owner)).turns[0]?.attempts[0]).toEqual(
      result.attempt,
    );
    stub.enqueue(response('New answer'));
    await submitTurn(compose(), submission({ text: 'A new question' }));
    expect(JSON.stringify(stub.requests[1]!.body.input)).not.toContain(
      'PRIVATE',
    );
  });

  it('starts no work at composition and rebuilds follow-up context from persisted answers', async () => {
    const loop = compose();
    expect(stub.requests).toHaveLength(0);
    stub.enqueue(response('We discussed gardens.'));
    const first = await submitTurn(
      loop,
      submission({ text: 'Let us discuss gardens.' }),
    );
    expect(first.attempt).toMatchObject({
      state: 'completed',
      answer: 'We discussed gardens.',
      inputTokens: 11,
      outputTokens: 7,
    });
    stub.enqueue(response('A contextual follow-up'));
    await submitTurn(
      compose(),
      submission({ text: 'What were we discussing?' }),
    );
    expect(stub.requests).toHaveLength(2);
    const request = stub.requests[1]!.body;
    expect(JSON.stringify(request.input)).toContain('We discussed gardens.');
    expect(request).toMatchObject({
      model: 'test-model',
      store: false,
      max_output_tokens: limits.maxOutputTokens,
    });
    expect(request.tools).toEqual([
      expect.objectContaining({ type: 'web_search' }),
    ]);
    expect(request.max_tool_calls).toBe(limits.maxToolCalls);
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
    const original = submitTurn(loop, input);
    try {
      await vi.waitFor(() => expect(stub.requests).toHaveLength(1));
      const replays = await Promise.all(
        Array.from({ length: 4 }, () => submitTurn(other, input)),
      );
      expect(
        replays.every(
          (replay) => !replay.execute && replay.attempt.state === 'running',
        ),
      ).toBe(true);
      await expect(submitTurn(other, submission())).rejects.toMatchObject({
        code: 'BUSY',
      });
      await expect(
        submitTurn(other, { ...input, text: 'Changed payload' }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(stub.requests).toHaveLength(1);
    } finally {
      held
        ?.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(response()));
      await original;
    }
    expect((await submitTurn(other, input)).attempt.state).toBe('completed');
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
    const first = await submitTurn(loop, input);
    expect(first.attempt).toMatchObject({
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
      answer: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect((await submitTurn(loop, input)).execute).toBe(false);
    expect(stub.requests).toHaveLength(1);
    stub.enqueue(response('Retried answer'));
    const retryInput = {
      ownerId,
      historyVersion: 0,
      turnId: first.turn.id,
      requestId: randomUUID(),
    };
    const retry = await retryTurn(loop, retryInput);
    expect(retry.attempt).toMatchObject({
      state: 'completed',
      attemptNumber: 2,
    });
    expect(retry.attempt.id).not.toBe(first.attempt.id);
    expect((await retryTurn(loop, retryInput)).execute).toBe(false);
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
    expect((await submitTurn(restored, input)).execute).toBe(false);
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
    expect((await submitTurn(restored, input)).execute).toBe(false);
    expect(stub.requests).toHaveLength(0);
    stub.enqueue(response('Fresh run after restart'));
    const retry = await retryTurn(restored, {
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

  it.each(['submit', 'retry'] as const)(
    '%s cancels an actual pending SDK request at the application deadline without another run',
    async (operation) => {
      let first;
      if (operation === 'retry') {
        stub.enqueue(
          { error: { message: 'Synthetic failure', type: 'api_error' } },
          503,
        );
        first = await submitTurn(compose(), submission());
      }
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
        if (operation === 'retry') startResponseStream(res);
      });
      const result = first
        ? await loop.retry(
            ownerId,
            first.turn.id,
            { historyVersion: 0, requestId: randomUUID() },
            () => {},
          )
        : await submitTurn(loop, submission());
      expect(result.attempt).toMatchObject({
        state: 'interrupted',
        errorCode: 'INTERRUPTED',
        answer: null,
        inputTokens: null,
        outputTokens: null,
      });
      await cancelled;
      expect(stub.requests).toHaveLength(operation === 'retry' ? 2 : 1);
      expect((await loop.history(ownerId)).turns[0]?.attempts.at(-1)).toEqual(
        result.attempt,
      );
    },
  );

  it('rejects invalid, unknown-owner, and non-retryable work before another SDK call', async () => {
    const loop = compose();
    await expect(
      submitTurn(loop, submission({ text: ' ' })),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      submitTurn(loop, submission({ ownerId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(stub.requests).toHaveLength(0);
    stub.enqueue(response());
    const result = await submitTurn(loop, submission());
    await expect(
      retryTurn(loop, {
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
    const result = await submitTurn(loop, submission());
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
      await submitTurn(compose(), submission());
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
      await expect(submitTurn(disabled, submission())).rejects.toMatchObject({
        code: 'EXECUTION_UNAVAILABLE',
      });
      await expect(
        retryTurn(disabled, {
          ownerId,
          historyVersion: 0,
          turnId: failed.turn.id,
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'EXECUTION_UNAVAILABLE' });
      expect(await disabled.history(ownerId)).toEqual(before);
      expect(stub.requests).toHaveLength(1);
      expect(await disabled.clear(ownerId, { historyVersion: 0 })).toBe(1);
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
      const result = await submitTurn(loop, submission());
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
    const result = await submitTurn(loop, submission());
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
    const result = await submitTurn(loop, submission());
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
    const retry = await retryTurn(compose(), {
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
    expect(stub.requests[2]!.body.tools).toEqual([
      expect.objectContaining({ type: 'web_search' }),
    ]);
    expect(stub.requests[2]!.body).not.toHaveProperty('previous_response_id');
  });

  it('persists SDK iteration-limit usage without publishing intermediate output', async () => {
    const { loop } = withTestTool(async () => 'Synthetic evidence');
    for (let step = 1; step <= 10; step++)
      stub.enqueue(toolResponse(7, [], step));
    const result = await submitTurn(loop, submission());
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
    const original = submitTurn(test.loop, oldInput).then(
      (value) => value,
      (error: unknown) => error,
    );
    try {
      await started;
      expect(await test.loop.clear(ownerId, { historyVersion: 0 })).toBe(1);
      expect(await original).toMatchObject({ code: 'STALE_HISTORY' });
      stub.enqueue(response('Only the new answer'));
      await submitTurn(
        compose(),
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
    await expect(submitTurn(test.loop, oldInput)).rejects.toMatchObject({
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
    const original = submitTurn(test.loop, submission()).then(
      (value) => value,
      (error: unknown) => error,
    );
    try {
      await started;
      expect(await compose().clear(ownerId, { historyVersion: 0 })).toBe(1);
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
