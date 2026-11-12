import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ZodError } from 'zod';
import { SessionState, sessionKey } from '../src/features/auth/session-state';
import { ObsoleteSessionError } from '../src/features/auth/session-scope';
import { createMemoryQueries } from '../src/features/memory/state/memory-queries';
import {
  memoryEntrySchema,
  memoryLimits,
  memorySnapshotSchema,
} from '../src/features/memory/api/memory-contracts';
import {
  MemoryApiError,
  getMemory,
  findSavedMemory,
} from '../src/features/memory/api/memory-api';
import { RequestError } from '../src/lib/api-request';

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
const session = {
  owner: { id: randomUUID(), email: 'owner@example.test' },
  expiresAt: '2099-11-09T10:00:00Z',
  idleExpiresAt: '2099-11-09T10:00:00Z',
};
const entry = {
  revision: 1,
  lastMutationRequestId: null,
  id: randomUUID(),
  requestId: randomUUID(),
  text: 'I prefer  small exercises.',
  sourceRequest: 'Remember that I prefer  small exercises. ',
  createdAt: '2026-11-09T10:00:00Z',
};
let queries: QueryClient;
let auth: SessionState;
let api: ReturnType<typeof createMemoryQueries>;
let respond: (request: Request) => Response | Promise<Response>;
let requests: Request[];
beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  auth = new SessionState(queries);
  auth.replace(session);
  api = createMemoryQueries(auth.scope(), queries);
  requests = [];
  vi.stubGlobal('window', { location: { origin: 'http://mentor.test' } });
  respond = (request) =>
    new URL(request.url).pathname.endsWith('/csrf')
      ? Response.json({ token: 'a'.repeat(64) })
      : Response.json(
          request.method === 'POST'
            ? entry
            : { entries: [entry], limits: memoryLimits },
        );
  transport.fetch.mockImplementation(async (request) => {
    requests.push(request);
    return respond(request);
  });
});
afterEach(() => {
  queries.clear();
});
const signal = () => new AbortController().signal;
describe('browser memory contracts and generated transport', () => {
  it('saves exact wording with CSRF/Origin, private reads, and no conversation call', async () => {
    const saved = await api.save(
      { requestId: entry.requestId, sourceRequest: entry.sourceRequest },
      signal(),
    );
    expect(saved).toEqual(entry);
    expect(await queries.fetchQuery(api.listOptions())).toEqual({
      entries: [entry],
      limits: memoryLimits,
    });
    const post = requests.find((request) => request.method === 'POST')!;
    expect(await post.json()).toEqual({
      requestId: entry.requestId,
      sourceRequest: entry.sourceRequest,
    });
    expect(post.headers.get('X-CSRF-Token')).toBe('a'.repeat(64));
    expect(post.headers.get('Origin')).toBe('http://mentor.test');
    expect(requests.every((request) => request.cache === 'no-store')).toBe(
      true,
    );
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/memory',
      '/api/v1/memory',
    ]);
  });
  it.each([
    { ...entry, id: 'bad' },
    { ...entry, text: 123 },
    { ...entry, createdAt: 'yesterday' },
    { ...entry, sourceRequest: null },
    { ...entry, requestId: 'invalid' },
  ])('rejects malformed memory records', (bad) => {
    expect(() => memoryEntrySchema.parse(bad)).toThrow(ZodError);
  });
  it('accepts changed server limits and corrected wording without replaying backend policy', () => {
    const corrected = { ...entry, text: 'I now prefer complete explanations.' };
    const limits = {
      maxEntries: 40,
      maxEntryBytes: 1024,
      maxProfileBytes: 8192,
      maxRequestBytes: 2048,
    };
    expect(
      memorySnapshotSchema.parse({ entries: [corrected], limits }),
    ).toEqual({ entries: [corrected], limits });
  });
  it.each([0, -1, 1.5, 'twenty'])(
    'rejects malformed numeric limit %j',
    (maxEntries) => {
      expect(() =>
        memorySnapshotSchema.parse({
          entries: [],
          limits: { ...memoryLimits, maxEntries },
        }),
      ).toThrow();
    },
  );
  it('checks detail, saved request, and POST response identities', async () => {
    respond = () => Response.json(entry);
    await expect(getMemory(randomUUID(), signal())).rejects.toThrow(
      'Invalid memory detail',
    );
    await expect(findSavedMemory(randomUUID(), signal())).rejects.toThrow(
      'Invalid saved-request',
    );
    respond = (request) =>
      new URL(request.url).pathname.endsWith('/csrf')
        ? Response.json({ token: 'a'.repeat(64) })
        : Response.json(entry);
    await expect(
      api.save(
        { requestId: randomUUID(), sourceRequest: entry.sourceRequest },
        signal(),
      ),
    ).rejects.toThrow('Invalid memory save');
  });
  it('does not retry missing saved requests or HTTP conflicts', async () => {
    respond = () =>
      Response.json({ statusCode: 404, code: 'NOT_FOUND' }, { status: 404 });
    await expect(api.find(entry.requestId, signal())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(requests).toHaveLength(1);
    respond = (request) =>
      new URL(request.url).pathname.endsWith('/csrf')
        ? Response.json({ token: 'a'.repeat(64) })
        : Response.json(
            { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' },
            { status: 409 },
          );
    await expect(
      api.save(
        { requestId: entry.requestId, sourceRequest: entry.sourceRequest },
        signal(),
      ),
    ).rejects.toBeInstanceOf(MemoryApiError);
  });
  it.each([401, 403])(
    'preserves auth status for malformed HTTP %i',
    async (status) => {
      respond = () => new Response('bad body', { status });
      await expect(api.find(entry.requestId, signal())).rejects.toBeInstanceOf(
        RequestError,
      );
      if (status === 401) expect(queries.getQueryData(sessionKey)).toBeNull();
    },
  );
  it('drops late list responses from a replaced session even if transport ignores abort', async () => {
    let release!: (response: Response) => void;
    respond = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = queries.fetchQuery(api.listOptions());
    const rejected = expect(pending).rejects.toBeDefined();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    auth.replace(session);
    release(Response.json({ entries: [entry], limits: memoryLimits }));
    await rejected;
    expect(
      queries.getQueryCache().findAll({ queryKey: ['memory'] }),
    ).toHaveLength(0);
    await expect(api.find(entry.requestId, signal())).rejects.toBeInstanceOf(
      ObsoleteSessionError,
    );
  });
  it('removes loaded memory data when signing out and scopes replacement queries separately', async () => {
    await queries.fetchQuery(api.listOptions());
    const oldKey = api.listOptions().queryKey;
    auth.replace(null);
    expect(queries.getQueryData(oldKey)).toBeUndefined();
    auth.replace(session);
    expect(
      createMemoryQueries(auth.scope(), queries).listOptions().queryKey,
    ).not.toEqual(oldKey);
  });
  it('publishes a committed edit/forget immediately so a slow refresh cannot display old wording', async () => {
    await queries.fetchQuery(api.listOptions());
    const updated = {
      ...entry,
      revision: 2,
      lastMutationRequestId: randomUUID(),
      text: 'New wording',
      sourceRequest: 'Remember that New wording',
    };
    api.changed(updated);
    expect(queries.getQueryData(api.listOptions().queryKey)).toMatchObject({
      entries: [updated],
    });
    const forgotten = {
      state: 'forgotten' as const,
      id: entry.id,
      requestId: entry.requestId,
      revision: 3,
      lastMutationRequestId: randomUUID(),
      forgottenAt: '2026-11-09T10:02:00Z',
    };
    api.changed(forgotten);
    expect(queries.getQueryData(api.listOptions().queryKey)).toMatchObject({
      entries: [],
    });
  });
  it('discards an older in-flight list read after publishing an edited memory', async () => {
    await queries.fetchQuery(api.listOptions());
    let release!: (response: Response) => void;
    respond = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = queries.fetchQuery(api.listOptions());
    const settled = pending.catch(() => undefined);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const updated = {
      ...entry,
      revision: 2,
      text: 'New wording',
      sourceRequest: 'Remember that New wording',
      lastMutationRequestId: randomUUID(),
    };
    api.changed(updated);
    await settled;
    release(Response.json({ entries: [entry], limits: memoryLimits }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(queries.getQueryData(api.listOptions().queryKey)).toMatchObject({
      entries: [updated],
    });
  });
});
