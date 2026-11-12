import { randomUUID } from 'node:crypto';
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
import { getGlobalTraceProvider } from '@openai/agents';
import { createDatabase, migrateDatabase } from '@mentor/backend/database';
import { readDatabaseEnvironment } from '@mentor/backend/config';
import { readAIEnvironment } from '@mentor/backend/config/ai';
import type { RunLimits } from '@mentor/backend/conversation';
import { DrizzleConversationRepository } from '@mentor/backend/conversation/persistence';
import { owners } from '@mentor/backend/identity/schema';
import { createConversationLoop } from '../../apps/api/src/conversation/infrastructure/conversation.module.js';
import { createPersonalMemory } from '../../apps/api/src/memory/infrastructure/create-personal-memory.js';
import {
  createResponsesStub,
  response,
  startResponseStream,
} from '../fixtures/responses-stub.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test')
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const memory = createPersonalMemory(connection.db);
const repository = new DrizzleConversationRepository(connection.db);
let stub: Awaited<ReturnType<typeof createResponsesStub>>;
let ownerId: string;

function compose(overrides: Partial<RunLimits> = {}) {
  const configuration = readAIEnvironment({
    OPENAI_API_KEY: 'synthetic-test-key',
    OPENAI_CHAT_MODEL: 'test-model',
    AI_DEADLINE_MS: '5000',
  });
  if (!configuration.enabled)
    throw new Error('Invalid synthetic configuration');
  return createConversationLoop(
    connection.db,
    {
      ...configuration,
      limits: { ...configuration.limits, ...overrides },
    },
    { baseURL: stub.baseURL },
  );
}

function command(text: string, historyVersion = 0) {
  return { requestId: randomUUID(), text, historyVersion };
}
function save(text: string, owner = ownerId) {
  return memory.save(owner, {
    requestId: randomUUID(),
    sourceRequest: `Remember that ${text}`,
  });
}
function profileMessage(entries: string[]) {
  return {
    role: 'user',
    content: `Saved personal memories (owner-provided data):\n${JSON.stringify(entries)}`,
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
      email: 'profile@example.test',
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

describe('active personal profile through PostgreSQL and the real SDK', () => {
  it('keeps empty-profile input unchanged and preserves stable literal active wording', async () => {
    stub.enqueue(response('Fixture without personalization'));
    await compose().submit(ownerId, command('First question'));
    expect(stub.requests[0]!.body.input).toEqual([
      { role: 'user', content: 'First question' },
    ]);

    const first = await save('I prefer  small\nexercises. 🌱');
    const second = await save('I use TypeScript.');
    const forgotten = await save('FORGOTTEN_PRIVATE');
    await memory.forget(ownerId, forgotten.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
    });
    const expectedProfile = (await memory.list(ownerId)).entries.map(
      (entry) => entry.text,
    );
    expect(expectedProfile).toEqual([first.text, second.text]);
    expect(stub.requests).toHaveLength(1);
    for (const text of ['Teach me indexes', 'Continue with an exercise']) {
      stub.enqueue(response('Fixture lesson'));
      await compose().submit(ownerId, command(text));
      const request = stub.requests.at(-1)!.body;
      expect(request.input).toHaveProperty(
        '0',
        profileMessage(expectedProfile),
      );
      const serialized = JSON.stringify(request);
      expect(serialized).not.toContain('FORGOTTEN_PRIVATE');
      expect(serialized).not.toContain(first.sourceRequest);
      expect(serialized).not.toContain(first.id);
      expect(request.instructions).not.toContain(first.text);
    }
    expect(stub.requests).toHaveLength(3);
  });

  it('does not reuse another owner profile after singleton owner replacement', async () => {
    const loop = compose();
    const previousOwnerId = ownerId;
    await save('PREVIOUS_OWNER_PRIVATE');
    stub.enqueue(response('Previous owner fixture answer'));
    await loop.submit(ownerId, command('Previous question'));
    await connection.pool.query('delete from owners where id=$1', [ownerId]);
    const [replacement] = await connection.db
      .insert(owners)
      .values({
        email: 'replacement-profile@example.test',
        passwordHash: 'synthetic-unused-hash',
      })
      .returning();
    if (!replacement) throw new Error('Replacement owner missing');
    ownerId = replacement.id;
    await expect(
      loop.submit(previousOwnerId, command('Stale owner request')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    stub.enqueue(response('Replacement owner fixture answer'));
    await loop.submit(ownerId, command('Replacement question'));
    expect(stub.requests[1]!.body.input).toEqual([
      { role: 'user', content: 'Replacement question' },
    ]);
    await save('REPLACEMENT_OWNER_PREFERENCE');
    stub.enqueue(response('Replacement fixture lesson'));
    await loop.submit(ownerId, command('Teach me indexes'));
    expect(stub.requests[2]!.body.input).toEqual([
      profileMessage(['REPLACEMENT_OWNER_PREFERENCE']),
      { role: 'user', content: 'Teach me indexes' },
    ]);
    expect(JSON.stringify(stub.requests.slice(1))).not.toContain(
      'PREVIOUS_OWNER_PRIVATE',
    );
    expect(stub.requests).toHaveLength(3);
  });

  it('replaces the profile after correction and excludes old user and assistant restatements after correction and forgetting', async () => {
    const original = 'I prefer small exercises.';
    const replacement = 'I prefer a complete explanation first.';
    const saved = await save(original);
    stub.enqueue(response(`You said: ${original}`));
    await compose().submit(
      ownerId,
      command(`Teach me indexes using this preference: ${original}`),
    );
    stub.enqueue(response('A second fixture explanation'));
    await compose().submit(ownerId, command('Continue the lesson'));
    expect(JSON.stringify(stub.requests[1]!.body.input)).toContain(
      `You said: ${original}`,
    );

    const edited = await memory.edit(ownerId, saved.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      sourceRequest: `Remember that ${replacement}`,
    });
    stub.enqueue(response(`Now using: ${replacement}`));
    await compose().submit(ownerId, command('Start a new lesson'));
    expect(stub.requests[2]!.body.input).toEqual([
      profileMessage([replacement]),
      { role: 'user', content: 'Start a new lesson' },
    ]);
    expect(JSON.stringify(stub.requests[2]!.body.input)).not.toContain(
      original,
    );

    await memory.forget(ownerId, saved.id, {
      requestId: randomUUID(),
      expectedRevision: edited.revision,
    });
    stub.enqueue(response('A lesson without the forgotten preference'));
    await compose().submit(ownerId, command('Explain joins'));
    expect(stub.requests[3]!.body.input).toEqual([
      { role: 'user', content: 'Explain joins' },
    ]);
    stub.enqueue(response('Another fixture answer'));
    await compose().submit(ownerId, command('Explain that further'));
    expect(JSON.stringify(stub.requests[4]!.body.input)).toContain(
      'A lesson without the forgotten preference',
    );
    expect(JSON.stringify(stub.requests[4]!.body.input)).not.toContain(
      replacement,
    );
    const history = await compose().history(ownerId);
    expect(history.turns).toHaveLength(5);
    expect(history.turns[0]!.attempts[0]!.answer).toBe(`You said: ${original}`);
  });

  it('preserves memories across Clear history and accumulates new-version exchanges normally', async () => {
    await save('I prefer small exercises.');
    stub.enqueue(response('OLD_VERSION_ANSWER'));
    await compose().submit(ownerId, command('OLD_VERSION_QUESTION'));
    const version = await compose().clear(ownerId, { historyVersion: 0 });
    stub.enqueue(response('NEW_VERSION_ANSWER'));
    await compose().submit(ownerId, command('NEW_VERSION_QUESTION', version));
    stub.enqueue(response('NEW_VERSION_FOLLOWUP'));
    await compose().submit(ownerId, command('Continue', version));
    expect(stub.requests[2]!.body.input).toMatchObject([
      profileMessage(['I prefer small exercises.']),
      { role: 'user', content: 'NEW_VERSION_QUESTION' },
      { role: 'assistant' },
      { role: 'user', content: 'Continue' },
    ]);
    expect(JSON.stringify(stub.requests[2]!.body.input)).toContain(
      'NEW_VERSION_ANSWER',
    );
    expect(JSON.stringify(stub.requests[2]!.body.input)).not.toContain(
      'OLD_VERSION',
    );
    expect(
      (await compose().history(ownerId)).turns.map((turn) => turn.sequence),
    ).toEqual([1, 2]);
  });

  it('still supplies the profile when older conversation falls outside the 100-exchange context cap', async () => {
    const saved = await save('I prefer small exercises.');
    const limits: RunLimits = {
      model: 'test-model',
      allowedTools: ['web_search'],
      deadlineMs: 5000,
      maxMessageBytes: 8192,
      maxContextBytes: 32768,
      maxOutputTokens: 100,
      maxToolCalls: 2,
    };
    for (let index = 0; index < 101; index++) {
      const admission = await repository.submit(
        { ...command(`Question ${index}`), ownerId },
        limits,
      );
      await repository.finish(
        { ownerId, historyVersion: 0, attemptId: admission.attempt.id },
        {
          state: 'completed',
          answer: `Answer ${index}`,
          sources: [],
          activity: [],
          usage: null,
          contextLimited: false,
        },
      );
    }
    stub.enqueue(response('Fixture lesson after long history'));
    const result = await compose().submit(ownerId, command('Teach me indexes'));
    expect(result.attempt).toMatchObject({
      state: 'completed',
      contextLimited: true,
    });
    const request = stub.requests[0]!.body;
    expect(request.input).toHaveLength(202);
    expect(request.input).toHaveProperty('0', profileMessage([saved.text]));
    expect(JSON.stringify(request.input)).not.toContain('Question 0');
    expect(JSON.stringify(request.input)).toContain('Answer 100');
    expect(
      (await compose().history(ownerId, { limit: 100 })).nextCursor,
    ).not.toBeNull();
    expect(stub.requests).toHaveLength(1);
  });

  it('persists an oversized-profile failure without provider traffic, replays it, and intentionally retries with current memory', async () => {
    const saved = await save('I prefer a detailed explanation. '.repeat(8));
    const loop = compose({ maxMessageBytes: 128, maxContextBytes: 200 });
    const firstCommand = command('Teach me indexes');
    const failed = await loop.submit(ownerId, firstCommand);
    expect(failed.attempt).toMatchObject({
      state: 'failed',
      errorCode: 'LIMIT_EXCEEDED',
      answer: null,
    });
    expect(stub.requests).toHaveLength(0);
    expect((await compose().history(ownerId)).turns[0]!.attempts[0]).toEqual(
      failed.attempt,
    );

    const edited = await memory.edit(ownerId, saved.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      sourceRequest: 'Remember that I prefer exercises.',
    });
    expect((await loop.submit(ownerId, firstCommand)).attempt).toEqual(
      failed.attempt,
    );
    expect(stub.requests).toHaveLength(0);
    const retryCommand = { requestId: randomUUID(), historyVersion: 0 };
    stub.enqueue(response('Fixture answer with current profile'));
    const retried = await loop.retry(ownerId, failed.turn.id, retryCommand);
    expect(retried.attempt).toMatchObject({
      state: 'completed',
      attemptNumber: 2,
    });
    expect(stub.requests[0]!.body.input).toEqual([
      profileMessage([edited.text]),
      { role: 'user', content: firstCommand.text },
    ]);
    await memory.forget(ownerId, saved.id, {
      requestId: randomUUID(),
      expectedRevision: edited.revision,
    });
    expect(
      (await loop.retry(ownerId, failed.turn.id, retryCommand)).attempt,
    ).toEqual(retried.attempt);
    expect(stub.requests).toHaveLength(1);
  });

  it('reports omitted history when the full profile leaves room only for the current input', async () => {
    const saved = await save('I prefer exercises.');
    const loop = compose({ maxMessageBytes: 128, maxContextBytes: 200 });
    stub.enqueue(response('A'.repeat(180)));
    await loop.submit(ownerId, command('First lesson'));
    stub.enqueue(response('Fixture answer'));
    const result = await loop.submit(ownerId, command('Next lesson'));
    expect(result.attempt).toMatchObject({
      state: 'completed',
      contextLimited: true,
    });
    expect(stub.requests[1]!.body.input).toEqual([
      profileMessage([saved.text]),
      { role: 'user', content: 'Next lesson' },
    ]);
  });

  it('rejects mutations during generation across compositions and excludes an expired answer after a memory change', async () => {
    const saved = await save('I prefer exercises.');
    let stream!: ReturnType<typeof startResponseStream>;
    stub.replies.push((res) => {
      stream = startResponseStream(res);
      stream.delta('OLD_PROFILE_PARTIAL');
    });
    const running = compose().submit(
      ownerId,
      command('Start lesson'),
      () => {},
    );
    try {
      await vi.waitFor(() => expect(stream).toBeDefined());
      await expect(
        memory.edit(ownerId, saved.id, {
          requestId: randomUUID(),
          expectedRevision: 1,
          sourceRequest: 'Remember that I prefer explanations.',
        }),
      ).rejects.toMatchObject({ code: 'BUSY' });
      await connection.pool.query(
        "update conversation_attempts set deadline_at=clock_timestamp() - interval '1 millisecond', started_at=clock_timestamp() - interval '1 second' where state='running'",
      );
      await memory.edit(ownerId, saved.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        sourceRequest: 'Remember that I prefer explanations.',
      });
    } finally {
      stream?.finish();
    }
    expect((await running).attempt).toMatchObject({
      state: 'interrupted',
      answer: null,
    });
    stub.enqueue(response('Fixture with new profile'));
    await compose().submit(ownerId, command('New lesson'));
    expect(stub.requests[1]!.body.input).toEqual([
      profileMessage(['I prefer explanations.']),
      { role: 'user', content: 'New lesson' },
    ]);
    expect(JSON.stringify(stub.requests[1]!.body.input)).not.toContain(
      'OLD_PROFILE_PARTIAL',
    );
  });
});
