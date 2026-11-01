import { randomUUID } from 'node:crypto';
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
import { Argon2PasswordHasher } from '@mentor/backend/identity/crypto';
import { OpenAIConversationModel } from '@mentor/backend/conversation/model';
import type { RunOutcome } from '@mentor/backend/conversation';
import { createApiApplication } from '../../apps/api/src/create-application.js';
import type {
  ConversationHistoryDto,
  TurnResultDto,
} from '../../apps/api/src/conversation/adapters/driving/http/conversation.dto.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test') {
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
}
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const origin = 'http://127.0.0.1:3000';
const privateKey = 'synthetic-http-secret-never-return';
const credentials = {
  email: 'owner@example.test',
  password: 'private test password',
};
const completed: RunOutcome = {
  state: 'completed',
  answer: 'Synthetic answer',
  sources: [],
  activity: [],
  usage: { inputTokens: 12, outputTokens: 3 },
  contextLimited: false,
};
const complete = vi.spyOn(OpenAIConversationModel.prototype, 'complete');
let app: Awaited<ReturnType<typeof createApiApplication>>;
let url: string;
let cookie: string;
let token: string;
let owner: string;

async function start(enabled = true): Promise<void> {
  vi.stubEnv('OPENAI_API_KEY', enabled ? privateKey : '');
  app = await createApiApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  url = `${await app.getUrl()}/api/v1`;
}

async function csrf(currentCookie = '') {
  const response = await fetch(`${url}/auth/csrf`, {
    headers: { cookie: currentCookie },
  });
  const body = (await response.json()) as { token: string };
  return {
    token: body.token,
    cookie: [
      currentCookie
        .split('; ')
        .find((value) => value.startsWith('mentor-session=')),
      response.headers.getSetCookie()[0]?.split(';')[0],
    ]
      .filter(Boolean)
      .join('; '),
  };
}

async function signIn() {
  const initial = await csrf();
  const response = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: {
      origin,
      cookie: initial.cookie,
      'x-csrf-token': initial.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  owner = ((await response.json()) as { owner: { id: string } }).owner.id;
  const bound = await csrf(response.headers.getSetCookie()[0]?.split(';')[0]);
  cookie = bound.cookie;
  token = bound.token;
}

function request(
  path: string,
  method = 'GET',
  body?: unknown,
  overrides: Record<string, string> = {},
) {
  return fetch(`${url}${path}`, {
    method,
    headers: {
      cookie,
      origin,
      'x-csrf-token': token,
      'content-type': 'application/json',
      ...overrides,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const text = await response.text();
  expect(text).not.toContain(privateKey);
  expect(text).not.toContain('password_hash');
  expect(text).not.toContain('token_hash');
  return JSON.parse(text) as T;
}

function submission(overrides = {}) {
  return {
    historyVersion: 0,
    requestId: randomUUID(),
    text: 'Synthetic question',
    ...overrides,
  };
}

describe('actual conversation HTTP boundary', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('APP_ORIGIN', origin);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('OPENAI_CHAT_MODEL', 'synthetic-http-model');
    vi.stubEnv('AI_MAX_MESSAGE_BYTES', '8192');
    vi.stubEnv('AI_MAX_CONTEXT_BYTES', '32768');
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '2048');
    vi.stubEnv('AI_DEADLINE_MS', '60000');
    await migrateDatabase(connection);
    await start();
  });

  beforeEach(async () => {
    complete.mockReset().mockResolvedValue(completed);
    await connection.pool.query('truncate owners, login_throttle cascade');
    await connection.pool.query(
      'insert into owners (email, password_hash) values ($1, $2)',
      [
        credentials.email,
        await new Argon2PasswordHasher().hash(credentials.password),
      ],
    );
    await signIn();
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      complete.mockRestore();
      vi.unstubAllEnvs();
      await connection.pool.end();
    }
  });

  it('returns only public configuration and an empty singleton without creating rows or model work', async () => {
    expect(await json(await request('/assistant/status'))).toEqual({
      enabled: true,
      limits: {
        model: 'synthetic-http-model',
        maxMessageBytes: 8192,
        maxContextBytes: 32768,
        maxOutputTokens: 2048,
        deadlineMs: 60000,
      },
    });
    expect(await json(await request('/conversation'))).toEqual({
      historyVersion: 0,
      turns: [],
      nextCursor: null,
    });
    expect(
      (await connection.pool.query('select * from conversations')).rows,
    ).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('requires valid sessions on every endpoint and rejects expired sessions', async () => {
    for (const [path, method, body] of [
      ['/assistant/status', 'GET', undefined],
      ['/conversation', 'GET', undefined],
      ['/conversation/turns', 'POST', submission()],
      [
        `/conversation/turns/${randomUUID()}/retry`,
        'POST',
        { historyVersion: 0, requestId: randomUUID() },
      ],
      ['/conversation/history', 'DELETE', { historyVersion: 0 }],
    ] as const) {
      // Anonymous mutations carry a valid anonymous CSRF pair to reach the session check.
      const anonymous = await csrf();
      await json(
        await request(path, method, body, {
          cookie: anonymous.cookie,
          'x-csrf-token': anonymous.token,
        }),
        401,
      );
    }
    await connection.pool.query(
      "update sessions set expires_at = now() - interval '1 second'",
    );
    await json(await request('/conversation'), 401);
    expect(complete).not.toHaveBeenCalled();
  });

  it('enforces Origin and session-bound CSRF on submit, retry, and clear before changing history', async () => {
    const anonymous = await csrf();
    for (const [path, method, body] of [
      ['/conversation/turns', 'POST', submission()],
      [
        `/conversation/turns/${randomUUID()}/retry`,
        'POST',
        { historyVersion: 0, requestId: randomUUID() },
      ],
      ['/conversation/history', 'DELETE', { historyVersion: 0 }],
    ] as const) {
      for (const headers of [
        { origin: '' },
        { origin: 'https://untrusted.example' },
        { 'x-csrf-token': '' },
        { 'x-csrf-token': '0'.repeat(64) },
        { 'x-csrf-token': anonymous.token },
        { cookie: `${cookie}; ${cookie}` },
      ]) {
        await json(await request(path, method, body, headers), 403);
      }
    }
    expect(await json(await request('/conversation'))).toEqual({
      historyVersion: 0,
      turns: [],
      nextCursor: null,
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('submits once, replays the same attempt, paginates, and rejects conflicting or stale requests', async () => {
    const input = submission();
    const first = await json<TurnResultDto>(
      await request('/conversation/turns', 'POST', input),
    );
    expect(first).toMatchObject({
      historyVersion: 0,
      turn: { requestId: input.requestId, text: input.text, sequence: 1 },
      attempt: {
        state: 'completed',
        answer: 'Synthetic answer',
        inputTokens: 12,
        outputTokens: 3,
      },
    });
    expect(first).not.toHaveProperty('execute');
    expect(first.turn).not.toHaveProperty('ownerId');
    expect(first.attempt.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(
      await json(await request('/conversation/turns', 'POST', input)),
    ).toEqual(first);
    expect(
      await json(
        await request('/conversation/turns', 'POST', {
          ...input,
          text: 'Different input',
        }),
        409,
      ),
    ).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const second = await json<TurnResultDto>(
      await request('/conversation/turns', 'POST', submission()),
    );
    const page = await json<ConversationHistoryDto>(
      await request('/conversation?limit=1'),
    );
    expect(page.turns.map((turn) => turn.id)).toEqual([second.turn.id]);
    expect(page.nextCursor).toEqual({ historyVersion: 0, beforeSequence: 2 });
    const older = await json<ConversationHistoryDto>(
      await request('/conversation?limit=1&historyVersion=0&beforeSequence=2'),
    );
    expect(older.turns.map((turn) => turn.id)).toEqual([first.turn.id]);
    expect(older.nextCursor).toBeNull();
    expect(
      await json(
        await request(`/conversation/turns/${first.turn.id}/retry`, 'POST', {
          historyVersion: 0,
          requestId: randomUUID(),
        }),
        409,
      ),
    ).toMatchObject({ code: 'NOT_RETRYABLE' });
    expect(
      await json(
        await request('/conversation/history', 'DELETE', { historyVersion: 0 }),
      ),
    ).toEqual({ historyVersion: 1 });
    expect(
      await json(
        await request('/conversation?historyVersion=0&beforeSequence=2'),
        409,
      ),
    ).toMatchObject({ code: 'STALE_HISTORY' });
    expect(
      await json(await request('/conversation/turns', 'POST', input), 409),
    ).toMatchObject({ code: 'STALE_HISTORY' });
    expect(
      await json(
        await request('/conversation/history', 'DELETE', { historyVersion: 0 }),
        409,
      ),
    ).toMatchObject({ code: 'STALE_HISTORY' });
    expect(await json(await request('/conversation'))).toEqual({
      historyVersion: 1,
      turns: [],
      nextCursor: null,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('replays a running admission without another call and returns a distinct busy error', async () => {
    let finish!: (outcome: RunOutcome) => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    complete.mockImplementationOnce(() => {
      started();
      return new Promise<RunOutcome>((resolve) => {
        finish = resolve;
      });
    });
    const input = submission();
    const first = request('/conversation/turns', 'POST', input);
    await running;
    try {
      const replay = await json<TurnResultDto>(
        await request('/conversation/turns', 'POST', input),
      );
      expect(replay.attempt.state).toBe('running');
      expect(
        await json(
          await request('/conversation/turns', 'POST', submission()),
          409,
        ),
      ).toMatchObject({ code: 'BUSY' });
      const history = await json<ConversationHistoryDto>(
        await request('/conversation'),
      );
      expect(history.turns[0]?.attempts[0]?.id).toBe(replay.attempt.id);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      finish(completed);
      await json(await first);
    }
  });

  it('returns stable failed outcomes and explicitly retries with a fresh attempt without duplicating input', async () => {
    complete.mockRejectedValueOnce(
      new Error(`provider-private-payload ${privateKey}`),
    );
    const first = await json<TurnResultDto>(
      await request('/conversation/turns', 'POST', submission()),
    );
    expect(first.attempt).toMatchObject({
      state: 'failed',
      answer: null,
      errorCode: 'PROVIDER_ERROR',
    });
    const retry = { historyVersion: 0, requestId: randomUUID() };
    const path = `/conversation/turns/${first.turn.id}/retry`;
    const result = await json<TurnResultDto>(
      await request(path, 'POST', retry),
    );
    expect(result.turn).toEqual(first.turn);
    expect(result.attempt).toMatchObject({
      state: 'completed',
      attemptNumber: 2,
    });
    expect(result.attempt.id).not.toBe(first.attempt.id);
    expect(await json(await request(path, 'POST', retry))).toEqual(result);
    const history = await json<ConversationHistoryDto>(
      await request('/conversation'),
    );
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0]?.attempts.map((attempt) => attempt.state)).toEqual([
      'failed',
      'completed',
    ]);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('takes ownership only from the session and exposes no conversation selectors', async () => {
    const turn = await json<TurnResultDto>(
      await request('/conversation/turns', 'POST', submission()),
    );
    for (const query of [
      `ownerId=${owner}`,
      `conversationId=${randomUUID()}`,
    ]) {
      await json(await request(`/conversation?${query}`), 400);
    }
    await json(
      await request(
        '/conversation/turns',
        'POST',
        submission({ ownerId: randomUUID() }),
      ),
      400,
    );
    await json(
      await request('/conversation/history', 'DELETE', {
        historyVersion: 0,
        ownerId: randomUUID(),
      }),
      400,
    );
    expect(
      await json(
        await request(`/conversation/turns/${randomUUID()}/retry`, 'POST', {
          historyVersion: 0,
          requestId: randomUUID(),
        }),
        404,
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    for (const path of ['/conversations', `/conversation/${randomUUID()}`])
      await json(await request(path), 404);
    await json(await request('/conversation', 'POST', {}), 404);
    const history = await json<ConversationHistoryDto>(
      await request('/conversation'),
    );
    expect(history.turns[0]?.id).toBe(turn.turn.id);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed bodies, media types, UUIDs, byte limits, and pagination without model work', async () => {
    for (const body of [
      [],
      {},
      submission({ requestId: 'bad' }),
      submission({ historyVersion: '0' }),
      submission({ historyVersion: -1 }),
      submission({ historyVersion: 0.5 }),
      submission({ historyVersion: Number.MAX_SAFE_INTEGER + 1 }),
      submission({ text: 1 }),
      submission({ text: '  ' }),
      submission({ text: '🙂'.repeat(2049) }),
      submission({ investigation: true }),
    ]) {
      expect(
        await json(await request('/conversation/turns', 'POST', body), 400),
      ).toMatchObject({ code: 'INVALID_INPUT' });
    }
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'limit=1&limit=2',
      'limit=1e1',
      'historyVersion=0',
      'beforeSequence=1',
      'historyVersion=0&beforeSequence=0',
      'historyVersion=-1&beforeSequence=1',
      'historyVersion=9007199254740992&beforeSequence=1',
    ])
      await json(await request(`/conversation?${query}`), 400);
    await json(
      await request('/conversation/turns/bad/retry', 'POST', {
        historyVersion: 0,
        requestId: randomUUID(),
      }),
      400,
    );
    await json(
      await request('/conversation/turns', 'POST', submission(), {
        'content-type': 'text/plain',
      }),
      415,
    );
    await json(
      await request('/conversation/history', 'DELETE', { historyVersion: '0' }),
      400,
    );
    const malformed = await fetch(`${url}/conversation/turns`, {
      method: 'POST',
      headers: {
        origin,
        cookie,
        'x-csrf-token': token,
        'content-type': 'application/json',
      },
      body: '{',
    });
    await json(malformed, 400);
    expect(
      await json(await request('/conversation/turns', 'POST', null), 400),
    ).toMatchObject({ code: 'BAD_REQUEST' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps history readable and clearable with execution disabled and redacts configuration failures', async () => {
    const first = await json<TurnResultDto>(
      await request('/conversation/turns', 'POST', submission()),
    );
    await app.close();
    await start(false);
    // CSRF is process-bound, so obtain a fresh signature for the restored session.
    const refreshed = await csrf(cookie);
    cookie = refreshed.cookie;
    token = refreshed.token;
    try {
      expect(await json(await request('/assistant/status'))).toEqual({
        enabled: false,
        limits: null,
      });
      const history = await json<ConversationHistoryDto>(
        await request('/conversation'),
      );
      expect(history.turns[0]?.id).toBe(first.turn.id);
      expect(
        await json(
          await request('/conversation/turns', 'POST', submission()),
          503,
        ),
      ).toMatchObject({ code: 'EXECUTION_UNAVAILABLE' });
      await json(
        await request(`/conversation/turns/${first.turn.id}/retry`, 'POST', {
          historyVersion: 0,
          requestId: randomUUID(),
        }),
        503,
      );
      expect(
        await json(
          await request('/conversation/history', 'DELETE', {
            historyVersion: 0,
          }),
        ),
      ).toEqual({ historyVersion: 1 });
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
      await start();
    }
  });
});
