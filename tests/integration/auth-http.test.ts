import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  readDatabaseEnvironment,
} from '@mentor/backend';
import { Argon2PasswordHasher } from '../../packages/backend/src/identity/adapters/driven/crypto/argon2-password.hasher.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test') {
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
}
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const credentials = {
  email: 'owner@example.test',
  password: 'private test password',
};
const origin = 'http://127.0.0.1:3000';
interface ApiServer {
  process: ChildProcess;
  url: string;
}
interface MutationCredentials {
  cookie: string;
  token: string;
}
let api: ApiServer;

async function stop(server: ApiServer) {
  if (
    !server.process.pid ||
    server.process.exitCode !== null ||
    server.process.signalCode !== null
  )
    return;
  const closed = once(server.process, 'close');
  server.process.kill('SIGTERM');
  const graceful = await Promise.race([
    closed.then(() => true),
    delay(3000, false, { ref: false }),
  ]);
  if (!graceful) {
    server.process.kill('SIGKILL');
    await closed;
  }
}

async function start(appOrigin: string): Promise<ApiServer> {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test port');
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const server = {
    process: spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        API_PORT: String(address.port),
        APP_ORIGIN: appOrigin,
        SESSION_IDLE_SECONDS: '60',
        SESSION_ABSOLUTE_SECONDS: '120',
      },
      stdio: 'ignore',
    }),
    url: `http://127.0.0.1:${address.port}/api/v1`,
  };
  let failed = false;
  server.process.on('error', () => {
    failed = true;
  });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failed || server.process.exitCode !== null)
        throw new Error('Test API failed to start');
      const ready = await fetch(`${server.url}/health/ready`, {
        signal: AbortSignal.timeout(500),
      }).catch(() => null);
      if (ready?.ok) return server;
      await delay(50);
    }
    throw new Error('Test API did not become ready');
  } catch (error) {
    await stop(server);
    throw error;
  }
}

async function csrf(server = api, cookie = ''): Promise<MutationCredentials> {
  const response = await fetch(`${server.url}/auth/csrf`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !('token' in body) ||
    typeof body.token !== 'string'
  )
    throw new Error('Missing CSRF token');
  expect(body.token).toMatch(/^[a-f0-9]{64}$/);
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatch(
    /^(?:__Host-)?mentor-csrf=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=120(?:; Secure)?$/,
  );
  if (cookies[0]?.startsWith('__Host-'))
    expect(cookies[0]).toMatch(/; Secure$/);
  const issued = cookies.map((value) => value.split(';')[0]).join('; ');
  const session = cookie
    .split('; ')
    .filter((value) => value.includes('mentor-session='));
  return { token: body.token, cookie: [...session, issued].join('; ') };
}

function login(
  csrfCredentials: MutationCredentials,
  overrides: RequestInit = {},
  server = api,
  appOrigin = origin,
) {
  return fetch(`${server.url}/auth/login`, {
    method: 'POST',
    headers: {
      origin: appOrigin,
      cookie: csrfCredentials.cookie,
      'x-csrf-token': csrfCredentials.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(credentials),
    ...overrides,
  });
}

describe('actual API authentication boundary', () => {
  beforeAll(async () => {
    await migrateDatabase(connection);
    api = await start(origin);
  });
  beforeEach(async () => {
    await connection.pool.query('truncate owners, login_throttle cascade');
    await connection.pool.query(
      'insert into owners (email, password_hash) values ($1, $2)',
      [
        credentials.email,
        await new Argon2PasswordHasher().hash(credentials.password),
      ],
    );
  });
  afterAll(async () => {
    try {
      if (api) await stop(api);
    } finally {
      await connection.pool.end();
    }
  });

  it('restores sessions across API restarts, refreshes session-bound CSRF, and revokes logout', async () => {
    const initial = await csrf();
    const response = await login(initial);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      owner: { email: credentials.email },
      expiresAt: expect.any(String),
      idleExpiresAt: expect.any(String),
    });
    const session = response.headers.getSetCookie()[0];
    expect(session).toMatch(
      /^mentor-session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=120$/,
    );
    const cookie = `${initial.cookie}; ${session?.split(';')[0]}`;
    const restored = await fetch(`${api.url}/auth/session`, {
      headers: { cookie },
    });
    expect(restored.status).toBe(200);
    expect(restored.headers.get('cache-control')).toContain('no-store');
    expect(await restored.json()).toMatchObject({
      owner: { email: credentials.email },
    });
    const logout = (token: string, currentCookie = cookie) =>
      fetch(`${api.url}/auth/logout`, {
        method: 'POST',
        headers: { origin, cookie: currentCookie, 'x-csrf-token': token },
      });
    expect((await logout(initial.token)).status).toBe(403);
    let renewed = await csrf(api, cookie);
    expect(renewed.token).not.toBe(initial.token);
    expect((await csrf(api, renewed.cookie)).token).toBe(renewed.token);
    await stop(api);
    api = await start(origin);
    expect(
      (await fetch(`${api.url}/auth/session`, { headers: { cookie } })).status,
    ).toBe(200);
    expect((await logout(renewed.token, renewed.cookie)).status).toBe(403);
    const refreshed = await csrf(api, renewed.cookie);
    expect(refreshed.token).not.toBe(renewed.token);
    renewed = refreshed;
    const revoked = await logout(renewed.token, renewed.cookie);
    expect(revoked.status).toBe(204);
    expect(revoked.headers.getSetCookie()).toContain(
      'mentor-session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    );
    expect(
      (await fetch(`${api.url}/auth/session`, { headers: { cookie } })).status,
    ).toBe(401);
    expect((await logout(renewed.token, renewed.cookie)).status).toBe(401);
  });

  it('rejects missing or forged mutation protections without consuming login attempts', async () => {
    const seed = await csrf();
    const headers = {
      origin,
      cookie: seed.cookie,
      'x-csrf-token': seed.token,
      'content-type': 'application/json',
    };
    for (const invalid of [
      { ...headers, origin: 'https://untrusted.example' },
      { ...headers, origin: '' },
      { ...headers, 'x-csrf-token': '' },
      { ...headers, 'x-csrf-token': '0'.repeat(64) },
      { ...headers, cookie: '' },
      { ...headers, cookie: `${seed.cookie}; ${seed.cookie}` },
    ]) {
      const response = await login(seed, { headers: invalid });
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect(
      (await connection.pool.query('select attempts from login_throttle')).rows,
    ).toEqual([]);
    expect((await login(seed)).status).toBe(200);
  });

  it('rejects malformed credentials, malformed JSON and unsupported media types', async () => {
    const seed = await csrf();
    expect(
      (
        await login(seed, {
          body: JSON.stringify({ email: 'invalid', password: 1 }),
        })
      ).status,
    ).toBe(401);
    expect((await login(seed, { body: '{' })).status).toBe(400);
    const response = await login(seed, {
      headers: {
        origin,
        cookie: seed.cookie,
        'x-csrf-token': seed.token,
        'content-type': 'text/plain',
      },
      body: 'not json',
    });
    expect(response.status).toBe(415);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects absent, duplicate and malformed session cookies', async () => {
    const response = await login(await csrf());
    const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
    if (!cookie) throw new Error('Missing session cookie');
    for (const value of [
      '',
      `${cookie}; ${cookie}`,
      'mentor-session=malformed',
      'mentor-session=%00',
    ]) {
      const rejected = await fetch(`${api.url}/auth/session`, {
        headers: { cookie: value },
      });
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get('cache-control')).toContain('no-store');
    }
  });

  it.each(['idle', 'absolute'] as const)(
    'rejects %s-expired sessions without exposing identity',
    async (deadline) => {
      const response = await login(await csrf());
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
      if (!cookie) throw new Error('Missing session cookie');
      await connection.pool.query(
        deadline === 'idle'
          ? "update sessions set last_seen_at = now() - interval '61 seconds'"
          : "update sessions set expires_at = now() - interval '1 second'",
      );
      const expired = await fetch(`${api.url}/auth/session`, {
        headers: { cookie },
      });
      expect(expired.status).toBe(401);
      expect(expired.headers.get('cache-control')).toContain('no-store');
      expect(await expired.json()).toEqual({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Sign-in failed or your session has expired.',
      });
    },
  );

  it('exposes no public signup or credential-reset endpoint', async () => {
    const seed = await csrf();
    for (const path of [
      'signup',
      'register',
      'reset-password',
      'password-reset',
    ]) {
      const response = await fetch(`${api.url}/auth/${path}`, {
        method: 'POST',
        headers: {
          origin,
          cookie: seed.cookie,
          'x-csrf-token': seed.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      });
    }
  });

  it('preserves throttling across API restart and returns Retry-After without a session cookie', async () => {
    const seed = await csrf();
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await login(seed, {
        body: JSON.stringify({
          ...credentials,
          email: attempt % 2 ? 'unknown@example.test' : credentials.email,
          password: 'incorrect password',
        }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Sign-in failed or your session has expired.',
      });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    await stop(api);
    api = await start(origin);
    const throttled = await login(await csrf());
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(throttled.headers.get('retry-after'))).toBeLessThanOrEqual(
      900,
    );
    expect(throttled.headers.get('cache-control')).toContain('no-store');
    expect(throttled.headers.getSetCookie()).toEqual([]);
  });

  it('uses Secure host-only cookies when the configured browser origin is HTTPS', async () => {
    const secureOrigin = 'https://mentor.example.test';
    const secureApi = await start(secureOrigin);
    try {
      const seed = await csrf(secureApi);
      expect(seed.cookie).toMatch(/^__Host-mentor-csrf=/);
      const response = await login(seed, {}, secureApi, secureOrigin);
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()[0]).toMatch(
        /^__Host-mentor-session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=120; Secure$/,
      );
    } finally {
      await stop(secureApi);
    }
  });
});
