import { ObsoleteSessionError } from '../src/features/auth/session-scope.js';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ZodError } from 'zod';
import { AuthError } from '../src/features/auth/auth-api.js';
import {
  SessionState,
  sessionKey,
} from '../src/features/auth/session-state.js';
import { ConversationApiError } from '../src/features/conversation/api/conversation-errors.js';
import { createConversationQueries } from '../src/features/conversation/state/conversation-queries.js';
import { ObsoleteHistoryError } from '../src/features/conversation/state/conversation-scope.js';
import { RequestError } from '../src/lib/api-request.js';
import { getConversationHistory } from '../src/features/conversation/api/conversation-api.js';
import { ConversationSubmission } from '../src/features/conversation/state/conversation-submission.js';

// Install before the real generated client captures its browser transport.
const transport = vi.hoisted(() => {
  const fetch = vi.fn<(request: Request) => Promise<Response>>();
  const NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(value: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof value === 'string'
            ? new URL(value, 'http://mentor.test')
            : value,
          init,
        );
      }
    },
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch };
});

const origin = 'http://mentor.test';
const owner = { id: randomUUID(), email: 'owner@example.test' };
const session = {
  owner,
  expiresAt: '2026-11-02T12:00:00.000Z',
  idleExpiresAt: '2026-11-01T12:00:00.000Z',
};
const input = {
  historyVersion: 0,
  requestId: randomUUID(),
  text: 'Synthetic question',
};
const turn = {
  id: randomUUID(),
  requestId: input.requestId,
  sequence: 1,
  text: input.text,
  createdAt: '2026-11-01T10:00:00.000Z',
};
const attempt = {
  id: randomUUID(),
  turnId: turn.id,
  requestId: input.requestId,
  attemptNumber: 1,
  model: 'synthetic-model',
  state: 'completed' as const,
  startedAt: turn.createdAt,
  deadlineAt: '2026-11-01T10:01:00.000Z',
  finishedAt: '2026-11-01T10:00:01.000Z',
  answer: 'Synthetic answer',
  errorCode: null,
  sources: [],
  activity: [],
  inputTokens: null,
  outputTokens: 0,
  contextLimited: true,
};
const result = { historyVersion: 0, turn, attempt };
const history = {
  historyVersion: 0,
  turns: [{ ...turn, attempts: [attempt] }],
  nextCursor: { historyVersion: 0, beforeSequence: 1 },
};
const ready = {
  enabled: true,
  limits: {
    model: 'synthetic-model',
    maxMessageBytes: 8192,
    maxContextBytes: 32768,
    maxOutputTokens: 1000,
    deadlineMs: 60000,
  },
};
const csrf = { token: 'a'.repeat(64) };
const requests: Request[] = [];
const clients: QueryClient[] = [];
let respond: (request: Request) => Response | Promise<Response>;

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queries);
  const auth = new SessionState(queries);
  auth.replace(session);
  return {
    queries,
    auth,
    api: createConversationQueries(auth.scope(), queries),
  };
}
function waitForRequest(path: string) {
  return vi.waitFor(() =>
    expect(
      requests.some((request) => new URL(request.url).pathname === path),
    ).toBe(true),
  );
}

beforeEach(() => {
  requests.length = 0;
  respond = (request) =>
    new URL(request.url).pathname.endsWith('/csrf') ? json(csrf) : json(result);
  vi.stubGlobal('window', { location: { origin } });
  transport.fetch.mockImplementation(async (request) => {
    requests.push(request);
    return respond(request);
  });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe('validated conversation HTTP boundary', () => {
  it('reads status and paginated history without changing keys, states, versions or usage', async () => {
    const { api } = setup();
    respond = (request) =>
      json(new URL(request.url).pathname.endsWith('/status') ? ready : history);
    expect(await api.status()).toEqual(ready);
    expect(
      await api.history({
        cursor: { historyVersion: 0, beforeSequence: 2 },
        limit: 10,
      }),
    ).toEqual(history);
    const url = new URL(requests[1]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      historyVersion: '0',
      beforeSequence: '2',
      limit: '10',
    });
    expect(
      requests.every(
        (request) =>
          request.cache === 'no-store' && request.credentials === 'same-origin',
      ),
    ).toBe(true);
  });

  it('exposes stateless validated HTTP functions independently of session and query state', async () => {
    const { queries } = setup();
    respond = () => json(history);
    expect(
      await getConversationHistory({}, new AbortController().signal),
    ).toEqual(history);
    const current = { historyVersion: 1, turns: [], nextCursor: null };
    respond = () => json(current);
    expect(
      await getConversationHistory({}, new AbortController().signal),
    ).toEqual(current);
    respond = () => json(history);
    expect(
      await getConversationHistory({}, new AbortController().signal),
    ).toEqual(history);
    expect(queries.getQueriesData({ queryKey: ['conversation'] })).toEqual([]);
  });

  it('sends JSON with a fresh CSRF token for submit, explicit retry, and clear', async () => {
    const { api } = setup();
    expect(await api.submit(input)).toEqual(result);
    const retry = { historyVersion: 0, requestId: randomUUID() };
    respond = (request) =>
      new URL(request.url).pathname.endsWith('/csrf')
        ? json(csrf)
        : request.method === 'DELETE'
          ? json({ historyVersion: 1 })
          : json({
              ...result,
              attempt: {
                ...attempt,
                requestId: retry.requestId,
                attemptNumber: 2,
              },
            });
    expect((await api.retry(turn.id, retry)).attempt.requestId).toBe(
      retry.requestId,
    );
    expect(await api.clear({ historyVersion: 0 })).toEqual({
      historyVersion: 1,
    });
    const writes = requests.filter((request) => request.method !== 'GET');
    expect(
      writes.map((request) => [request.method, new URL(request.url).pathname]),
    ).toEqual([
      ['POST', '/api/v1/conversation/turns'],
      ['POST', `/api/v1/conversation/turns/${turn.id}/retry`],
      ['DELETE', '/api/v1/conversation/history'],
    ]);
    expect(await writes[0]!.json()).toEqual(input);
    for (const request of writes) {
      expect(request.headers.get('Content-Type')).toBe('application/json');
      expect(request.headers.get('X-CSRF-Token')).toBe(csrf.token);
      expect(request.headers.get('Origin')).toBe(origin);
    }
    expect(
      requests.filter((request) =>
        new URL(request.url).pathname.endsWith('/csrf'),
      ),
    ).toHaveLength(3);
  });

  it.each(['running', 'completed', 'failed', 'interrupted'] as const)(
    'preserves %s attempt state',
    async (state) => {
      const { api } = setup();
      const variant = {
        ...attempt,
        state,
        finishedAt: state === 'running' ? null : attempt.finishedAt,
        answer: state === 'completed' ? attempt.answer : null,
        errorCode:
          state === 'failed'
            ? 'PROVIDER_ERROR'
            : state === 'interrupted'
              ? 'INTERRUPTED'
              : null,
      };
      respond = (request) =>
        new URL(request.url).pathname.endsWith('/csrf')
          ? json(csrf)
          : json({ ...result, attempt: variant });
      expect((await api.submit(input)).attempt).toEqual(variant);
    },
  );

  it.each([
    ['status boolean', 'status', { ...ready, enabled: 'true' }],
    ['status limits', 'status', { enabled: false, limits: ready.limits }],
    ['history version', 'history', { ...history, historyVersion: -1 }],
    [
      'cursor version',
      'history',
      { ...history, nextCursor: { historyVersion: 1, beforeSequence: 2 } },
    ],
    [
      'attempt state',
      'submit',
      { ...result, attempt: { ...attempt, state: 'unknown' } },
    ],
    [
      'terminal state',
      'submit',
      { ...result, attempt: { ...attempt, answer: null } },
    ],
    [
      'usage',
      'submit',
      { ...result, attempt: { ...attempt, outputTokens: -1 } },
    ],
    [
      'unsafe source',
      'submit',
      {
        ...result,
        attempt: {
          ...attempt,
          sources: [{ title: 'bad', url: 'javascript:alert(1)' }],
        },
      },
    ],
    [
      'turn identity',
      'submit',
      { ...result, attempt: { ...attempt, turnId: randomUUID() } },
    ],
    ['clear version', 'clear', { historyVersion: '1' }],
  ] as const)('rejects malformed %s', async (_name, operation, body) => {
    const { api } = setup();
    respond = (request) =>
      new URL(request.url).pathname.endsWith('/csrf') ? json(csrf) : json(body);
    const promise =
      operation === 'status'
        ? api.status()
        : operation === 'history'
          ? api.history()
          : operation === 'clear'
            ? api.clear({ historyVersion: 0 })
            : api.submit(input);
    await expect(promise).rejects.toBeInstanceOf(ZodError);
  });

  it.each([
    ['EXECUTION_UNAVAILABLE', 503],
    ['NOT_FOUND', 404],
    ['INVALID_INPUT', 400],
    ['STALE_HISTORY', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['BUSY', 409],
    ['NOT_RETRYABLE', 409],
  ] as const)(
    'preserves %s without replaying or signing out',
    async (code, status) => {
      const { api, queries } = setup();
      respond = (request) =>
        new URL(request.url).pathname.endsWith('/csrf')
          ? json(csrf)
          : json(
              {
                code,
                statusCode: status,
                message: 'untrusted sensitive message',
              },
              status,
            );
      const failure = await api.submit(input).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ConversationApiError);
      expect(failure).toMatchObject({ status, code });
      expect(String(failure)).not.toContain('sensitive');
      expect(queries.getQueryData(sessionKey)).toEqual(session);
      expect(
        requests.filter((request) => request.method === 'POST'),
      ).toHaveLength(1);
    },
  );

  it.each(['token', 'mutation'] as const)(
    'keeps a %s CSRF failure distinct from session expiry',
    async (stage) => {
      const { api, queries } = setup();
      respond = (request) =>
        stage === 'mutation' && request.method === 'GET'
          ? json(csrf)
          : json({ code: 'FORBIDDEN' }, 403);
      await expect(api.submit(input)).rejects.toMatchObject({ status: 403 });
      expect(queries.getQueryData(sessionKey)).toEqual(session);
      expect(requests).toHaveLength(stage === 'token' ? 1 : 2);
    },
  );

  it('does not send a mutation after a malformed CSRF response', async () => {
    const { api } = setup();
    respond = () => json({ token: 'invalid' });
    await expect(api.submit(input)).rejects.toBeInstanceOf(ZodError);
    expect(requests).toHaveLength(1);
  });

  it('does not retry an uncertain network outcome or generate a new request key', async () => {
    const { api } = setup();
    respond = (request) => {
      if (request.method === 'GET') return json(csrf);
      throw new TypeError('Synthetic lost response');
    };
    await expect(api.submit(input)).rejects.toThrow('Synthetic lost response');
    expect(
      requests.filter((request) => request.method === 'POST'),
    ).toHaveLength(1);
    expect(await requests[1]!.json()).toEqual(input);
  });
});

describe('session and history isolation with deferred HTTP', () => {
  it.each(['success', '401'] as const)(
    'rejects a late %s after sign-in replacement',
    async (outcome) => {
      const { api, auth, queries } = setup();
      const pending = deferred<Response>();
      respond = () => pending.promise;
      const old = api.history().catch((error: unknown) => error);
      await waitForRequest('/api/v1/conversation');
      const replacement = {
        ...session,
        owner: { id: randomUUID(), email: 'replacement@example.test' },
      };
      auth.replace(replacement);
      pending.resolve(outcome === '401' ? json({}, 401) : json(history));
      expect(await old).toBeInstanceOf(ObsoleteSessionError);
      expect(queries.getQueryData(sessionKey)).toEqual(replacement);
      expect(queries.getQueryData(['conversation'])).toBeUndefined();
    },
  );

  it.each(['logout', 'expiry'] as const)(
    'cancels private queries and rejects late mutations after %s',
    async (reason) => {
      const { api, auth, queries } = setup();
      const pendingMutation = deferred<Response>();
      const pendingRead = deferred<Response>();
      respond = (request) =>
        new URL(request.url).pathname.endsWith('/csrf')
          ? json(csrf)
          : request.method === 'POST'
            ? pendingMutation.promise
            : pendingRead.promise;
      const write = api
        .submit(input)
        .then((value) => {
          queries.setQueryData(['conversation', 'late'], value);
        })
        .catch((error: unknown) => error);
      const read = queries
        .fetchQuery({
          ...api.historyOptions(),
        })
        .catch((error: unknown) => error);
      await waitForRequest('/api/v1/conversation/turns');
      await waitForRequest('/api/v1/conversation');
      queries.setQueryData(['private-other'], 'private');
      respond = (request) =>
        new URL(request.url).pathname.endsWith('/csrf')
          ? json(csrf)
          : reason === 'logout'
            ? new Response(null, { status: 204 })
            : json({}, 401);
      if (reason === 'logout') await auth.signOut();
      else await expect(api.status()).rejects.toMatchObject({ status: 401 });
      expect(queries.getQueryData(sessionKey)).toBeNull();
      expect(
        queries
          .getQueryCache()
          .getAll()
          .map((query) => query.queryKey),
      ).toEqual([sessionKey]);
      expect(
        requests.find(
          (request) =>
            request.method === 'POST' && request.url.endsWith('/turns'),
        )!.signal.aborted,
      ).toBe(true);
      pendingMutation.resolve(json(result));
      pendingRead.resolve(json(history));
      expect(await write).toBeInstanceOf(ObsoleteSessionError);
      await read;
      expect(queries.getQueryData(['conversation', 'late'])).toBeUndefined();
    },
  );

  it('clears cached mutations and prevents an old mutation success callback after expiry', async () => {
    const { api, queries } = setup();
    const pending = deferred<Response>();
    respond = (request) =>
      new URL(request.url).pathname.endsWith('/csrf')
        ? json(csrf)
        : pending.promise;
    const onSuccess = vi.fn((value: unknown) =>
      queries.setQueryData(['conversation', 'late'], value),
    );
    const mutation = queries.getMutationCache().build(queries, {
      mutationKey: api.keys.all,
      mutationFn: () => api.submit(input),
      onSuccess,
      retry: false,
    });
    const work = mutation.execute(undefined).catch((error: unknown) => error);
    await waitForRequest('/api/v1/conversation/turns');
    respond = () => json({}, 401);
    await expect(api.status()).rejects.toBeInstanceOf(RequestError);
    pending.resolve(json(result));
    await work;
    expect(onSuccess).not.toHaveBeenCalled();
    expect(queries.getMutationCache().getAll()).toEqual([]);
    expect(queries.getQueryData(['conversation', 'late'])).toBeUndefined();
  });

  it('rejects pre-clear history and mutation responses and discards cached pages', async () => {
    const { api, queries } = setup();
    respond = () => json(history);
    await api.history();
    queries.setQueryData(
      api.keys.history({ cursor: { historyVersion: 0, beforeSequence: 2 } }),
      history,
    );
    const pendingRead = deferred<Response>();
    const pendingWrite = deferred<Response>();
    respond = (request) =>
      request.url.endsWith('/csrf')
        ? json(csrf)
        : request.method === 'POST'
          ? pendingWrite.promise
          : pendingRead.promise;
    const read = queries
      .fetchQuery(api.historyOptions())
      .catch((error: unknown) => error);
    const write = api
      .submit(input)
      .then((value) => queries.setQueryData(['conversation', 'late'], value))
      .catch((error: unknown) => error);
    await waitForRequest('/api/v1/conversation/turns');
    respond = (request) =>
      request.method === 'GET' ? json(csrf) : json({ historyVersion: 1 });
    await api.clear({ historyVersion: 0 });
    pendingRead.resolve(json(history));
    pendingWrite.resolve(json(result));
    await read;
    expect(await write).toBeInstanceOf(ObsoleteHistoryError);
    expect(queries.getQueriesData({ queryKey: ['conversation'] })).toEqual([]);
    expect(() => api.assertCurrent(0)).toThrow(ObsoleteHistoryError);
    await expect(api.submit(input)).rejects.toBeInstanceOf(
      ObsoleteHistoryError,
    );
    respond = () => json({ historyVersion: 1, turns: [], nextCursor: null });
    expect(await api.history()).toEqual({
      historyVersion: 1,
      turns: [],
      nextCursor: null,
    });
  });

  it('delivers a new-version head while discarding obsolete pages and retaining current pages and unrelated state', async () => {
    const { api, queries } = setup();
    respond = () => json(history);
    const options = api.historyOptions();
    await queries.fetchQuery(options);
    const olderOptions = api.historyOptions({
      cursor: { historyVersion: 0, beforeSequence: 2 },
    });
    queries.setQueryData(olderOptions.queryKey, history);
    queries.setQueryData(api.keys.status, ready);
    queries.setQueryData(['notes'], 'Unrelated cached data');
    const current = { historyVersion: 1, turns: [], nextCursor: null };
    const currentPageKey = api.keys.history({
      cursor: { historyVersion: 1, beforeSequence: 2 },
    });
    queries.setQueryData(currentPageKey, current);
    const mutations = queries.getMutationCache();
    const unrelated = mutations.build(queries, {
      mutationKey: ['notes', 'save'],
      mutationFn: async () => 'Saved note',
    });
    await unrelated.execute(undefined);
    const obsoleteMutation = mutations.build(queries, {
      mutationKey: api.keys.all,
      mutationFn: async () => result,
    });
    await obsoleteMutation.execute(undefined);

    const pending = deferred<Response>();
    respond = () => pending.promise;
    const olderRead = queries
      .fetchQuery(olderOptions)
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    respond = () => json(current);
    expect(await queries.fetchQuery(options)).toEqual(current);
    pending.resolve(json(history));
    await olderRead;

    expect(queries.getQueryData(options.queryKey)).toEqual(current);
    expect(queries.getQueryData(olderOptions.queryKey)).toBeUndefined();
    expect(queries.getQueryData(currentPageKey)).toEqual(current);
    expect(queries.getQueryData(api.keys.status)).toEqual(ready);
    expect(queries.getQueryData(['notes'])).toBe('Unrelated cached data');
    expect(mutations.getAll()).toEqual([unrelated]);
  });

  it('clear removes old head/pages without discarding status or unrelated mutations', async () => {
    const { api, queries } = setup();
    respond = () => json(history);
    await queries.fetchQuery(api.historyOptions());
    queries.setQueryData(
      api.keys.history({ cursor: { historyVersion: 0, beforeSequence: 2 } }),
      history,
    );
    queries.setQueryData(api.keys.status, ready);
    const mutations = queries.getMutationCache();
    const unrelated = mutations.build(queries, {
      mutationKey: ['notes', 'save'],
      mutationFn: async () => 'Saved note',
    });
    await unrelated.execute(undefined);
    respond = (request) =>
      request.method === 'GET' ? json(csrf) : json({ historyVersion: 1 });
    expect(await api.clear({ historyVersion: 0 })).toEqual({
      historyVersion: 1,
    });
    expect(queries.getQueriesData({ queryKey: api.keys.histories })).toEqual(
      [],
    );
    expect(queries.getQueryData(api.keys.status)).toEqual(ready);
    expect(mutations.getAll()).toEqual([unrelated]);
  });

  it('loads messages added after clearing instead of installing an assumed empty head', async () => {
    const { api, queries } = setup();
    respond = () => json(history);
    const initial = await queries.fetchQuery(api.historyOptions());
    const latest = { ...history, historyVersion: 1, nextCursor: null };
    respond = (request) =>
      request.url.endsWith('/csrf')
        ? json(csrf)
        : request.method === 'DELETE'
          ? json({ historyVersion: 1 })
          : json(latest);
    const submission = new ConversationSubmission({
      assertCurrent: api.assertCurrent,
      clear: api.clear,
      refresh: () =>
        queries.fetchQuery({ ...api.historyOptions(), staleTime: 0 }),
      submit: vi.fn(),
      retry: vi.fn(),
    });
    submission.observe(initial);
    submission.edit('A draft to discard');
    await submission.clear(0);
    expect(queries.getQueryData(api.keys.history())).toEqual(latest);
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      historyVersion: 1,
      historyClear: { phase: 'idle' },
    });
    expect(
      requests.filter((request) => request.method === 'DELETE'),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.method === 'POST'),
    ).toHaveLength(0);
  });

  it('keeps query keys scoped to a sign-in and rejects obsolete query options before HTTP', async () => {
    const { api, auth, queries } = setup();
    const old = api.historyOptions();
    auth.replace(session);
    const replacement = createConversationQueries(auth.scope(), queries);
    expect(replacement.keys.all).not.toEqual(api.keys.all);
    await expect(queries.fetchQuery(old)).rejects.toBeInstanceOf(
      ObsoleteSessionError,
    );
    expect(requests).toHaveLength(0);
  });

  it('rejects an older head response when another read observes a newer history version', async () => {
    const { api } = setup();
    respond = () => json(history);
    await api.history();
    const pending = deferred<Response>();
    respond = () => pending.promise;
    const old = api.history().catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    respond = () => json({ historyVersion: 1, turns: [], nextCursor: null });
    await api.history();
    pending.resolve(json(history));
    expect(await old).toBeInstanceOf(ObsoleteHistoryError);
  });

  it('honors caller cancellation even when the HTTP fake ignores abort', async () => {
    const { api, queries } = setup();
    const pending = deferred<Response>();
    respond = () => pending.promise;
    const controller = new AbortController();
    const work = api.status(controller.signal).catch((error: unknown) => error);
    await waitForRequest('/api/v1/assistant/status');
    controller.abort();
    pending.resolve(json(ready));
    expect(await work).toMatchObject({ name: 'AbortError' });
    expect(queries.getQueryData(sessionKey)).toEqual(session);
  });

  it('rejects late output when clearing before the initial history read finishes', async () => {
    const { api } = setup();
    const pending = deferred<Response>();
    respond = () => pending.promise;
    const old = api.history().catch((error: unknown) => error);
    await waitForRequest('/api/v1/conversation');
    respond = (request) =>
      request.method === 'GET' ? json(csrf) : json({ historyVersion: 1 });
    await api.clear({ historyVersion: 0 });
    pending.resolve(json(history));
    expect(await old).toBeInstanceOf(ObsoleteHistoryError);
  });

  it('expires a protected session even when its 401 body is malformed JSON', async () => {
    const { api, queries } = setup();
    respond = () =>
      new Response('not JSON', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    await expect(api.status()).rejects.toMatchObject({ status: 401 });
    expect(queries.getQueryData(sessionKey)).toBeNull();
  });

  it('rejects malformed success JSON without replaying the request', async () => {
    const { api } = setup();
    respond = (request) =>
      request.url.endsWith('/csrf')
        ? json(csrf)
        : new Response('not JSON', {
            headers: { 'Content-Type': 'application/json' },
          });
    await expect(api.submit(input)).rejects.toBeInstanceOf(SyntaxError);
    expect(
      requests.filter((request) => request.method === 'POST'),
    ).toHaveLength(1);
  });

  it('stops between CSRF and POST when the session changes', async () => {
    const { api, auth } = setup();
    const pending = deferred<Response>();
    respond = () => pending.promise;
    const work = api.submit(input).catch((error: unknown) => error);
    await waitForRequest('/api/v1/auth/csrf');
    auth.replace(null);
    pending.resolve(json(csrf));
    expect(await work).toBeInstanceOf(ObsoleteSessionError);
    expect(requests).toHaveLength(1);
  });
});

describe('existing authentication through the shared boundary', () => {
  it('keeps credential errors separate, restores a session, and signs in/out', async () => {
    const { auth, queries } = setup();
    respond = () => json(session);
    expect(await auth.read(new AbortController().signal)).toEqual(session);
    respond = (request) =>
      request.url.endsWith('/csrf') ? json(csrf) : json({}, 401);
    await expect(
      auth.signIn(owner.email, 'synthetic-password'),
    ).rejects.toBeInstanceOf(AuthError);
    expect(queries.getQueryData(sessionKey)).toEqual(session);
    respond = (request) =>
      request.url.endsWith('/csrf') ? json(csrf) : json(session);
    queries.setQueryData(['private-old'], history);
    await auth.signIn(owner.email, 'synthetic-password');
    expect(queries.getQueryData(['private-old'])).toBeUndefined();
    expect(queries.getQueryData(sessionKey)).toEqual(session);
    respond = (request) =>
      request.url.endsWith('/csrf')
        ? json(csrf)
        : new Response(null, { status: 204 });
    await auth.signOut();
    expect(queries.getQueryData(sessionKey)).toBeNull();
  });

  it.each([429, 403, 503])(
    'retains sign-in handling for %i',
    async (status) => {
      const { auth } = setup();
      respond = (request) =>
        request.url.endsWith('/csrf')
          ? json(csrf)
          : Response.json({}, { status, headers: { 'Retry-After': '120' } });
      await expect(
        auth.signIn(owner.email, 'synthetic-password'),
      ).rejects.toMatchObject({ status, retryAfterSeconds: 120 });
    },
  );

  it('clears private data when session restoration returns 401', async () => {
    const { auth, queries } = setup();
    queries.setQueryData(['private'], history);
    respond = () => json({}, 401);
    await queries.fetchQuery({
      queryKey: sessionKey,
      queryFn: ({ signal }) => auth.read(signal),
      staleTime: 0,
    });
    expect(queries.getQueryData(sessionKey)).toBeNull();
    expect(queries.getQueryData(['private'])).toBeUndefined();
  });

  it.each(['read', 'signIn', 'signOut'] as const)(
    'ignores late auth %s after replacement',
    async (operation) => {
      const { auth, queries } = setup();
      const pending = deferred<Response>();
      respond = (request) =>
        request.url.endsWith('/csrf') ? json(csrf) : pending.promise;
      const work = (
        operation === 'read'
          ? auth.read(new AbortController().signal)
          : operation === 'signIn'
            ? auth.signIn(owner.email, 'synthetic-password')
            : auth.signOut()
      ).catch((error: unknown) => error);
      await waitForRequest(
        `/api/v1/auth/${operation === 'read' ? 'session' : operation === 'signIn' ? 'login' : 'logout'}`,
      );
      const replacement = {
        ...session,
        owner: { id: randomUUID(), email: 'new@example.test' },
      };
      auth.replace(replacement);
      pending.resolve(
        operation === 'signOut'
          ? new Response(null, { status: 204 })
          : json(session),
      );
      expect(await work).toBeInstanceOf(ObsoleteSessionError);
      expect(queries.getQueryData(sessionKey)).toEqual(replacement);
    },
  );
});
