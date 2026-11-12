import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { createMemoryQueries } from '../src/features/memory/state/memory-queries';
import { memoryChangeOptions } from '../src/features/memory/state/memory-change';
import type {
  MemoryChangeAction,
  MemoryChangeCommand,
} from '../src/features/memory/state/memory-change';
import { MemoryApiError } from '../src/features/memory/api/memory-api';
import { ObsoleteSessionError } from '../src/features/auth/session-scope';
import type { MemoryRecord } from '../src/features/memory/api/memory-contracts';

const entry = {
  id: randomUUID(),
  requestId: randomUUID(),
  text: 'New wording',
  sourceRequest: 'Remember that New wording',
  createdAt: '2026-11-09T10:00:00Z',
  revision: 2,
  lastMutationRequestId: randomUUID(),
};
const command: MemoryChangeCommand = {
  kind: 'edit',
  entryId: entry.id,
  input: {
    requestId: entry.lastMutationRequestId,
    expectedRevision: 1,
    sourceRequest: entry.sourceRequest,
  },
};
const forgotten = {
  state: 'forgotten' as const,
  id: entry.id,
  requestId: entry.requestId,
  revision: 3,
  lastMutationRequestId: randomUUID(),
  forgottenAt: '2026-11-09T10:02:00Z',
};
const clients: QueryClient[] = [];
function setup() {
  const queries = new QueryClient({
    defaultOptions: { mutations: { retry: 3 } },
  });
  clients.push(queries);
  const lifetime = new AbortController();
  const session = {
    generation: 1,
    assertCurrent: vi.fn(),
    run: async <T>(request: (signal: AbortSignal) => Promise<T>) =>
      request(lifetime.signal),
  };
  const memory = {
    ...createMemoryQueries(session, queries),
    edit: vi.fn(async () => entry),
    forget: vi.fn(async () => forgotten),
    read: vi.fn<(...args: [string, AbortSignal]) => Promise<MemoryRecord>>(
      async () => entry,
    ),
    changed: vi.fn(),
  };
  const observer = new MutationObserver(
    queries,
    memoryChangeOptions(memory, () => lifetime.signal),
  );
  const run = (change = command, check = false, recovering = false) =>
    observer.mutate({
      command: change,
      check,
      recovering,
    } satisfies MemoryChangeAction);
  return { memory, lifetime, observer, run };
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('explicit edit and forget recovery', () => {
  it('confirms edits and does not automatically retry a failed write under global defaults', async () => {
    const { memory, run } = setup();
    await expect(run()).resolves.toEqual(entry);
    expect(memory.changed).toHaveBeenCalledOnce();
    memory.edit.mockRejectedValueOnce(new TypeError('Lost response'));
    await expect(run()).rejects.toThrow('Lost response');
    expect(memory.edit).toHaveBeenCalledTimes(2);
    await expect(run(command, true, true)).resolves.toEqual(entry);
    expect(memory.edit).toHaveBeenCalledTimes(2);
  });
  it('does not treat an unchanged read as proof a pending edit failed', async () => {
    const { memory, run } = setup();
    memory.read.mockResolvedValueOnce({
      ...entry,
      revision: 1,
      lastMutationRequestId: null,
    });
    await expect(run(command, true, true)).rejects.toThrow('still unconfirmed');
    expect(memory.changed).not.toHaveBeenCalled();
    expect(memory.edit).not.toHaveBeenCalled();
  });
  it.each([2, 3])(
    'rejects a revision %i belonging to another change without overwriting it',
    async (revision) => {
      const { memory, run } = setup();
      memory.read.mockResolvedValueOnce({
        ...entry,
        revision,
        lastMutationRequestId: randomUUID(),
      });
      await expect(run(command, true, true)).rejects.toMatchObject({
        code: 'ENTRY_CHANGED',
      });
      expect(memory.edit).not.toHaveBeenCalled();
    },
  );
  it('never accepts a conflicting latest request payload as its own edit', async () => {
    const { memory, run } = setup();
    memory.read.mockResolvedValueOnce({
      ...entry,
      sourceRequest: 'Remember that other',
    });
    await expect(run(command, true, true)).rejects.toMatchObject({
      code: 'ENTRY_CHANGED',
    });
  });
  it('resolves a lost forget response through metadata without any text or DELETE replay', async () => {
    const { memory, run } = setup();
    memory.read.mockResolvedValueOnce(forgotten);
    const deletion: MemoryChangeCommand = {
      kind: 'forget',
      entryId: entry.id,
      input: {
        requestId: forgotten.lastMutationRequestId,
        expectedRevision: 2,
      },
    };
    expect(await run(deletion, true, true)).toEqual(forgotten);
    expect(memory.forget).not.toHaveBeenCalled();
    expect(await run(deletion)).toEqual(forgotten);
  });
  it('reports forgetting observed during edit recovery instead of resaving the text', async () => {
    const { memory, run } = setup();
    memory.read.mockResolvedValueOnce(forgotten);
    await expect(run(command, true, true)).rejects.toMatchObject({
      code: 'FORGOTTEN',
    });
    expect(memory.edit).not.toHaveBeenCalled();
  });
  it('keeps missing and failed reads unconfirmed, without mutation replay', async () => {
    const { memory, run } = setup();
    memory.read
      .mockRejectedValueOnce(new MemoryApiError(404, 'NOT_FOUND'))
      .mockRejectedValueOnce(new TypeError('read failed'));
    await expect(run(command, true, true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(run(command, true, true)).rejects.toThrow('read failed');
    expect(memory.edit).not.toHaveBeenCalled();
  });
  it('ignores an edit that finishes after the session lifetime ends', async () => {
    const { memory, lifetime, run } = setup();
    let release!: () => void;
    memory.edit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(entry);
        }),
    );
    const operation = run();
    const rejected =
      expect(operation).rejects.toBeInstanceOf(ObsoleteSessionError);
    await vi.waitFor(() => expect(memory.edit).toHaveBeenCalledOnce());
    lifetime.abort(new ObsoleteSessionError());
    await rejected;
    release();
    await Promise.resolve();
    expect(memory.changed).not.toHaveBeenCalled();
  });
  it('bounds confirmation time and ignores a late result until explicit checking', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
        ms,
      );
      return controller.signal;
    });
    const { memory, run } = setup();
    let release!: () => void;
    memory.edit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(entry);
        }),
    );
    const pending = run();
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    release();
    await Promise.resolve();
    expect(memory.changed).not.toHaveBeenCalled();
    expect(await run(command, true, true)).toEqual(entry);
  });
});
