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
import { createDatabase, migrateDatabase } from '@mentor/backend/database';
import { readDatabaseEnvironment } from '@mentor/backend/config';
import { Argon2PasswordHasher } from '@mentor/backend/identity/crypto';
import { OpenAIConversationModel } from '@mentor/backend/conversation/model';
import { createApiApplication } from '../../apps/api/src/create-application.js';
import type {
  MemoryEntryDto,
  MemorySnapshotDto,
} from '../../apps/api/src/memory/adapters/driving/http/memory.dto.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test')
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const origin = 'http://127.0.0.1:3000';
const credentials = {
  email: 'memory-http@example.test',
  password: 'synthetic memory password',
};
const complete = vi
  .spyOn(OpenAIConversationModel.prototype, 'complete')
  .mockImplementation(async () => {
    throw new Error('Memory must never invoke a model');
  });
let app: Awaited<ReturnType<typeof createApiApplication>>;
let url: string;
let cookie: string;
let token: string;

async function start(enabled = false) {
  vi.stubEnv('OPENAI_API_KEY', enabled ? 'synthetic-unused-key' : '');
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
  const bound = await csrf(response.headers.getSetCookie()[0]?.split(';')[0]);
  cookie = bound.cookie;
  token = bound.token;
}

function request(
  path = '/memory',
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${url}${path}`, {
    method,
    headers: {
      cookie,
      origin,
      'x-csrf-token': token,
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const text = await response.text();
  for (const privateValue of [
    'synthetic-unused-key',
    'password_hash',
    'token_hash',
    'ownerId',
    'owner_id',
  ])
    expect(text).not.toContain(privateValue);
  return JSON.parse(text) as T;
}

function input() {
  return {
    requestId: randomUUID(),
    sourceRequest: 'Remember that   I prefer  small\nexercises. 🌱  ',
  };
}

describe('actual authenticated memory HTTP boundary', () => {
  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('APP_ORIGIN', origin);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('OPENAI_CHAT_MODEL', 'synthetic-memory-model');
    await migrateDatabase(connection);
    await start();
  });
  beforeEach(async () => {
    complete.mockClear();
    await connection.pool.query('truncate owners, login_throttle cascade');
    await connection.pool.query(
      'insert into owners(email,password_hash) values($1,$2)',
      [
        credentials.email,
        await new Argon2PasswordHasher().hash(credentials.password),
      ],
    );
    await signIn();
  });
  afterEach(async () => {
    expect(complete).not.toHaveBeenCalled();
    expect(
      (await connection.pool.query('select * from conversation_turns')).rows,
    ).toEqual([]);
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

  it('saves and inspects exact wording/source with execution disabled', async () => {
    expect(await json(await request('/assistant/status'))).toEqual({
      enabled: false,
      limits: null,
    });
    expect(await json<MemorySnapshotDto>(await request())).toEqual({
      entries: [],
      limits: {
        maxEntries: 20,
        maxEntryBytes: 512,
        maxProfileBytes: 4096,
        maxRequestBytes: 1024,
      },
    });
    const command = input();
    const saved = await json<MemoryEntryDto>(
      await request('/memory', 'POST', command),
    );
    expect(saved).toEqual({
      id: expect.any(String),
      requestId: command.requestId,
      text: 'I prefer  small\nexercises. 🌱',
      sourceRequest: command.sourceRequest,
      createdAt: expect.any(String),
    });
    expect(Number.isFinite(Date.parse(saved.createdAt))).toBe(true);
    expect(
      await json(await request(`/memory/requests/${command.requestId}`)),
    ).toEqual(saved);
    expect(await json(await request(`/memory/${saved.id}`))).toEqual(saved);
    expect((await json<MemorySnapshotDto>(await request())).entries).toEqual([
      saved,
    ]);
  });

  it('survives an API restart and finds the saved request to resolve a discarded save response', async () => {
    const command = input();
    const response = await request('/memory', 'POST', command);
    expect(response.status).toBe(200);
    await response.arrayBuffer(); // Deliberately do not consume the result as application state.
    await app.close();
    await start();
    const bound = await csrf(cookie);
    cookie = bound.cookie;
    token = bound.token;
    const recovered = await json<MemoryEntryDto>(
      await request(`/memory/requests/${command.requestId}`),
    );
    expect(recovered.text).toBe('I prefer  small\nexercises. 🌱');
    expect(await json(await request('/memory', 'POST', command))).toEqual(
      recovered,
    );
    expect(
      (await json<MemorySnapshotDto>(await request())).entries,
    ).toHaveLength(1);
  });

  it('also saves without invoking the configured model', async () => {
    await app.close();
    await start(true);
    try {
      const bound = await csrf(cookie);
      cookie = bound.cookie;
      token = bound.token;
      expect(await json(await request('/assistant/status'))).toMatchObject({
        enabled: true,
      });
      await json(await request('/memory', 'POST', input()));
    } finally {
      await app.close();
      await start();
    }
  });

  it('rejects conflicting request reuse, resolves exact replay and accepts independent saves', async () => {
    const command = input();
    const saved = await json(await request('/memory', 'POST', command));
    await json(await request('/memory', 'POST', input()));
    expect(
      await json(
        await request('/memory', 'POST', {
          ...command,
          sourceRequest: 'Remember that changed input.',
        }),
        409,
      ),
    ).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await json(await request('/memory', 'POST', command))).toEqual(
      saved,
    );
  });

  it.each([
    { sourceRequest: 'Ordinary conversation' },
    { sourceRequest: '"Remember that a quoted request."' },
    { sourceRequest: 'Remember that ' },
    { sourceRequest: `Remember that ${'🌱'.repeat(129)}` },
    { sourceRequest: 'Remember that \u0000' },
    { requestId: 'invalid' },
    { expectedProfileVersion: 0 },
    { ownerId: randomUUID() },
    { text: 'separate untrusted wording' },
  ])('rejects invalid command fields without saving: %j', async (changes) => {
    expect(
      await json(
        await request('/memory', 'POST', { ...input(), ...changes }),
        400,
      ),
    ).toMatchObject({ code: 'INVALID_INPUT' });
    expect((await json<MemorySnapshotDto>(await request())).entries).toEqual(
      [],
    );
  });

  it('validates route identifiers and does not resolve unaccepted requests', async () => {
    for (const path of ['/memory/not-a-uuid', '/memory/requests/not-a-uuid'])
      expect(await json(await request(path), 400)).toMatchObject({
        code: 'INVALID_INPUT',
      });
    for (const path of [
      `/memory/${randomUUID()}`,
      `/memory/requests/${randomUUID()}`,
    ])
      expect(await json(await request(path), 404)).toMatchObject({
        code: 'NOT_FOUND',
      });
  });

  it('protects every read route and saves with sessions, Origin and CSRF', async () => {
    const command = input();
    const saved = await json<MemoryEntryDto>(
      await request('/memory', 'POST', command),
    );
    for (const path of [
      '/memory',
      `/memory/${saved.id}`,
      `/memory/requests/${command.requestId}`,
    ]) {
      await json(await request(path, 'GET', undefined, { cookie: '' }), 401);
    }
    for (const headers of [
      { origin: 'https://other.example' },
      { origin: '' },
      { 'x-csrf-token': '' },
      { cookie: '' },
    ])
      await json(await request('/memory', 'POST', input(), headers), 403);
    await connection.pool.query('delete from sessions');
    for (const path of [
      '/memory',
      `/memory/${saved.id}`,
      `/memory/requests/${command.requestId}`,
    ])
      await json(await request(path), 401);
    await json(await request('/memory', 'POST', input()), 401);
  });

  it('rejects malformed JSON and unsupported media types without echoing content', async () => {
    await json(
      await request('/memory', 'POST', input(), {
        'content-type': 'text/plain',
      }),
      415,
    );
    const malformed = await fetch(`${url}/memory`, {
      method: 'POST',
      headers: {
        cookie,
        origin,
        'x-csrf-token': token,
        'content-type': 'application/json',
      },
      body: '{broken-private-input',
    });
    const body = await json(malformed, 400);
    expect(JSON.stringify(body)).not.toContain('broken-private-input');
    await json(
      await request('/memory', 'POST', {
        ...input(),
        sourceRequest: 'x'.repeat(110000),
      }),
      413,
    );
  });

  it('does not offer edit or forget routes before checkpoint 3', async () => {
    const saved = await json<MemoryEntryDto>(
      await request('/memory', 'POST', input()),
    );
    for (const method of ['PATCH', 'DELETE'])
      await json(await request(`/memory/${saved.id}`, method, {}), 404);
  });
});
