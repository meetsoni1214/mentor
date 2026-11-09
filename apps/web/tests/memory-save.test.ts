import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MutationObserver,
  QueryClient,
  onlineManager,
} from '@tanstack/react-query';
import {
  memorySaveOptions,
  memorySaveState,
} from '../src/features/memory/state/memory-save';
import type { MemorySaveAction } from '../src/features/memory/state/memory-save';
import { MemoryApiError } from '../src/features/memory/api/memory-api';
import { RequestError } from '../src/lib/api-request';
import { ObsoleteSessionError } from '../src/features/auth/session-scope';
import { memoryCommand } from '../src/features/memory/api/memory-contracts';
import type {
  MemoryEntry,
  SaveMemoryInput,
} from '../src/features/memory/api/memory-contracts';
import { ConversationSubmission } from '../src/features/conversation/state/conversation-submission';

const sourceRequest = 'Remember that I prefer  small exercises.  ';
const requestId = randomUUID();
const entry: MemoryEntry = {
  id: randomUUID(),
  requestId,
  sourceRequest,
  text: 'I prefer  small exercises.',
  createdAt: '2026-11-09T10:00:00Z',
};
const command = { input: { requestId, sourceRequest }, draftRevision: 7 };
const clients: QueryClient[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const port = {
    assertCurrent: vi.fn(),
    save: vi.fn(async (_input: SaveMemoryInput, _signal: AbortSignal) => entry),
    find: vi.fn(async (_id: string, _signal: AbortSignal) => entry),
    changed: vi.fn(),
    clearSubmittedDraft: vi.fn(),
  };
  const lifetime = new AbortController();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 3, retryDelay: 0 } },
  });
  clients.push(client);
  const mutation = new MutationObserver(
    client,
    memorySaveOptions(port, () => lifetime.signal),
  );
  const run = async (kind: MemorySaveAction['kind'], recovering = false) => {
    await mutation.mutate({ kind, command, recovering }).catch(() => {});
    return memorySaveState(mutation.getCurrentResult());
  };
  return {
    port,
    mutation,
    lifetime,
    run,
    state: () => memorySaveState(mutation.getCurrentResult()),
  };
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('shared literal memory command', () => {
  it('recognizes the direct prefix and preserves internal whitespace', () => {
    expect(
      memoryCommand('rEmEmBeR tHaT   I prefer  small\nexercises.  '),
    ).toEqual({ text: 'I prefer  small\nexercises.', error: null });
  });
  it.each([
    'Remember that ',
    `Remember that ${'é'.repeat(257)}`,
    'Remember that \0',
    'Remember that \ud800',
    `Remember that ${' '.repeat(1024)}a`,
  ])('rejects invalid payload %j', (request) => {
    expect(memoryCommand(request)?.error).toBeTruthy();
  });
  it.each([
    '"Remember that something"',
    'I said Remember that something',
    '```\nRemember that something\n```',
    ' Remember that something',
    'Remember this please',
  ])('leaves ordinary/quoted input as conversation %j', (request) => {
    expect(memoryCommand(request)).toBeNull();
  });
});
describe('Query mutation memory save recovery', () => {
  it('acknowledges a saved row and clears only the submitted draft revision', async () => {
    const { port, run } = setup();
    expect(await run('save')).toMatchObject({ phase: 'saved', pending: null });
    expect(port.clearSubmittedDraft).toHaveBeenCalledWith(7);
    expect(port.changed).toHaveBeenCalledOnce();
    expect(port.save.mock.calls[0]?.[0]).toEqual(command.input);
  });
  it('exposes in-flight state through the mutation without a second store', async () => {
    const { port, run, state } = setup();
    const wait = deferred<MemoryEntry>();
    port.save.mockReturnValueOnce(wait.promise);
    const pending = run('save');
    expect(state()).toMatchObject({ phase: 'saving', pending: command });
    wait.resolve(entry);
    await pending;
  });
  it.each([
    'BUSY',
    'INVALID_INPUT',
    'LIMIT_EXCEEDED',
    'IDEMPOTENCY_CONFLICT',
  ] as const)('preserves drafts on definitive %s rejection', async (code) => {
    const { port, run } = setup();
    port.save.mockRejectedValueOnce(new MemoryApiError(409, code));
    expect(await run('save')).toMatchObject({
      phase: 'rejected',
      pending: null,
    });
    expect(port.clearSubmittedDraft).not.toHaveBeenCalled();
  });
  it('retains lost-response identity across absent lookups, failed checks, and explicit retries', async () => {
    const { port, run } = setup();
    port.save.mockRejectedValueOnce(new TypeError('lost'));
    expect(await run('save')).toMatchObject({
      phase: 'uncertain',
      pending: command,
    });
    port.find.mockRejectedValueOnce(new MemoryApiError(404, 'NOT_FOUND'));
    expect((await run('check', true)).notice).toContain('may still finish');
    port.find.mockRejectedValueOnce(new RequestError(503));
    expect((await run('check', true)).pending).toBe(command);
    expect(port.save).toHaveBeenCalledOnce();
    expect((await run('save', true)).phase).toBe('saved');
    expect(port.save.mock.calls.map(([input]) => input)).toEqual([
      command.input,
      command.input,
    ]);
  });
  it('recovers a lost response with a read only, without retrying even under Query defaults', async () => {
    const { port, run } = setup();
    port.save.mockRejectedValueOnce(new TypeError('lost'));
    await run('save');
    expect((await run('check', true)).phase).toBe('saved');
    expect(port.find.mock.calls[0]?.[0]).toBe(requestId);
    expect(port.save).toHaveBeenCalledOnce();
  });
  it('does not queue a mutation to run automatically when connectivity returns', async () => {
    onlineManager.setOnline(false);
    const { port, run } = setup();
    port.save.mockRejectedValueOnce(new TypeError('offline'));
    expect((await run('save')).phase).toBe('uncertain');
    onlineManager.setOnline(true);
    await Promise.resolve();
    expect(port.save).toHaveBeenCalledOnce();
  });
  it('keeps uncertainty after a conflicting explicit replay', async () => {
    const { port, run } = setup();
    port.save
      .mockRejectedValueOnce(new TypeError('lost'))
      .mockRejectedValueOnce(new MemoryApiError(409, 'IDEMPOTENCY_CONFLICT'));
    await run('save');
    expect(await run('save', true)).toMatchObject({
      phase: 'uncertain',
      pending: command,
    });
  });
  it('times out after 15 seconds and ignores a late response until explicit recovery', async () => {
    vi.useFakeTimers();
    // Node implements AbortSignal.timeout with internal timers rather than fake timers.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const c = new AbortController();
      setTimeout(
        () => c.abort(new DOMException('Timed out', 'TimeoutError')),
        ms,
      );
      return c.signal;
    });
    const { port, run, state } = setup();
    const wait = deferred<MemoryEntry>();
    port.save.mockReturnValueOnce(wait.promise);
    const pending = run('save');
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(state().phase).toBe('uncertain');
    wait.resolve(entry);
    await Promise.resolve();
    expect(port.clearSubmittedDraft).not.toHaveBeenCalled();
    expect((await run('check', true)).phase).toBe('saved');
  });
  it.each([401, 403, 500])(
    'handles HTTP %i without clearing a draft or claiming success',
    async (status) => {
      const { port, run } = setup();
      port.save.mockRejectedValueOnce(new RequestError(status));
      expect((await run('save')).phase).toBe(
        status === 401 ? 'idle' : status === 403 ? 'rejected' : 'uncertain',
      );
      expect(port.clearSubmittedDraft).not.toHaveBeenCalled();
    },
  );
  it('keeps an unexplained transport abort uncertain', async () => {
    const { port, run } = setup();
    port.save.mockRejectedValueOnce(
      new DOMException('Network aborted', 'AbortError'),
    );
    expect((await run('save')).phase).toBe('uncertain');
  });
  it('aborts on unmount and ignores a late transport that disregards cancellation', async () => {
    const { port, run, lifetime } = setup();
    const wait = deferred<MemoryEntry>();
    port.save.mockReturnValueOnce(wait.promise);
    const pending = run('save');
    await vi.waitFor(() => expect(port.save).toHaveBeenCalledOnce());
    lifetime.abort(new ObsoleteSessionError());
    expect((await pending).phase).toBe('idle');
    wait.resolve(entry);
    await Promise.resolve();
    expect(port.changed).not.toHaveBeenCalled();
    expect(port.clearSubmittedDraft).not.toHaveBeenCalled();
  });
  it('ignores a completed request from a replaced session', async () => {
    const { port, run } = setup();
    const wait = deferred<MemoryEntry>();
    port.save.mockReturnValueOnce(wait.promise);
    const pending = run('save');
    await vi.waitFor(() => expect(port.save).toHaveBeenCalledOnce());
    port.assertCurrent.mockImplementation(() => {
      throw new ObsoleteSessionError();
    });
    wait.resolve(entry);
    expect((await pending).phase).toBe('idle');
    expect(port.changed).not.toHaveBeenCalled();
  });
  it('does not confirm a saved request containing a different original command', async () => {
    const { port, run } = setup();
    port.find.mockResolvedValueOnce({
      ...entry,
      sourceRequest: 'Remember that different wording',
    });
    expect((await run('check', true)).phase).toBe('uncertain');
    expect(port.clearSubmittedDraft).not.toHaveBeenCalled();
  });
  it('keeps an independently edited next draft, including a changed-back identical draft', () => {
    const submission = new ConversationSubmission({
      assertCurrent() {},
      submit: vi.fn(),
      retry: vi.fn(),
      clear: vi.fn(),
      refresh: vi.fn(),
    });
    submission.edit(sourceRequest);
    const revision = submission.getDraftRevision();
    submission.edit('Next message');
    submission.edit(sourceRequest);
    submission.clearSubmittedDraft(revision);
    expect(submission.getSnapshot().draft).toBe(sourceRequest);
    submission.clearSubmittedDraft(submission.getDraftRevision());
    expect(submission.getSnapshot().draft).toBe('');
  });
});
