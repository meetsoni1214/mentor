import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ClearInput,
  ConversationHistory,
  TurnResult,
} from '../src/features/conversation/api/conversation-contracts';
import type { ConversationStreamProgress } from '../src/features/conversation/api/conversation-stream-contracts';
import { ConversationSubmission } from '../src/features/conversation/state/conversation-submission';
import { ObsoleteHistoryError } from '../src/features/conversation/state/conversation-scope';
import { ObsoleteSessionError } from '../src/features/auth/session-scope';
import { ConversationApiError } from '../src/features/conversation/api/conversation-errors';
import { RequestError } from '../src/lib/api-request';
import {
  accepted,
  completed,
  delta,
  failed,
  historyOf,
  retryAccepted,
  retryCompleted,
} from './fixtures/conversation-stream';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const newHistory: ConversationHistory = {
  historyVersion: 1,
  turns: [],
  nextCursor: null,
};
const draft = 'Keep my independent draft';
function setup() {
  let version = 0;
  let alive = true;
  let emit!: (event: ConversationStreamProgress) => void;
  let reader!: AbortSignal;
  const execution = deferred<TurnResult>();
  const deletion = deferred<{ historyVersion: number }>();
  const clear = vi.fn(async (_input: ClearInput, _signal: AbortSignal) => {
    const result = await deletion.promise;
    version = result.historyVersion;
    return result;
  });
  const refresh = vi
    .fn<() => Promise<ConversationHistory>>()
    .mockResolvedValue(historyOf(failed));
  const publish = vi.fn();
  const deliver = (
    _input: unknown,
    progress: typeof emit,
    signal: AbortSignal,
  ) => {
    emit = progress;
    reader = signal;
    return execution.promise;
  };
  const submit = vi.fn(deliver);
  const retry = vi.fn(
    (
      _turnId: string,
      input: unknown,
      progress: typeof emit,
      signal: AbortSignal,
    ) => deliver(input, progress, signal),
  );
  const submission = new ConversationSubmission({
    clear,
    submit,
    retry,
    refresh,
    publish,
    assertCurrent(expected?: number) {
      if (!alive) throw new ObsoleteSessionError();
      if (expected !== undefined && expected !== version)
        throw new ObsoleteHistoryError();
    },
  });
  submission.observe(historyOf(failed));
  submission.edit(draft);
  return {
    submission,
    clear,
    refresh,
    submit,
    retry,
    publish,
    deletion,
    execution,
    emit: (event: ConversationStreamProgress) => emit(event),
    reader: () => reader,
    replaceHistory: (history = newHistory) => {
      version = history.historyVersion;
      submission.observe(history);
    },
    expire: () => {
      alive = false;
    },
    succeed: () => {
      refresh.mockResolvedValue(newHistory);
      deletion.resolve({ historyVersion: 1 });
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('explicit history clearing and recovery', () => {
  it('locks mutations and draft editing immediately, sends one exact version, and clears only on confirmation', async () => {
    const s = setup();
    const work = s.submission.clear(0);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      historyClear: { phase: 'clearing' },
    });
    await s.submission.clear(0);
    await s.submission.send(8192);
    await s.submission.retry(failed.turn.id, historyOf(failed));
    await s.submission.reconcile();
    s.submission.edit('Must not replace draft');
    expect(s.submission.getSnapshot().draft).toBe(draft);
    expect(s.clear).toHaveBeenCalledExactlyOnceWith(
      { historyVersion: 0 },
      expect.any(AbortSignal),
    );
    expect(s.submit).not.toHaveBeenCalled();
    expect(s.retry).not.toHaveBeenCalled();
    s.succeed();
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      historyVersion: 1,
      stream: null,
      phase: 'editing',
      historyClear: { phase: 'idle', notice: 'cleared' },
    });
    s.submission.edit('A new conversation message');
    expect(s.submission.getSnapshot().draft).toBe('A new conversation message');
  });

  it('ignores confirmation captured for an obsolete history version without issuing deletion', async () => {
    const s = setup();
    s.replaceHistory();
    await s.submission.clear(0);
    expect(s.clear).not.toHaveBeenCalled();
  });

  for (const operation of ['send', 'retry'] as const) {
    it(`detaches active ${operation} delivery and ignores late text/results after clearing`, async () => {
      const s = setup();
      const delivery =
        operation === 'send'
          ? s.submission.send(8192)
          : s.submission.retry(failed.turn.id, historyOf(failed));
      s.emit(operation === 'send' ? accepted : retryAccepted);
      s.submission.edit(draft);
      s.emit(
        operation === 'send'
          ? delta
          : { ...delta, attemptId: retryAccepted.attempt.id },
      );
      const clearing = s.submission.clear(0);
      s.succeed();
      await clearing;
      expect(s.reader().aborted).toBe(true);
      const published = s.publish.mock.calls.length;
      s.emit(
        operation === 'send'
          ? delta
          : { ...delta, attemptId: retryAccepted.attempt.id },
      );
      s.execution.resolve(operation === 'send' ? completed : retryCompleted);
      await delivery;
      expect(s.publish).toHaveBeenCalledTimes(published);
      expect(s.submission.getSnapshot()).toMatchObject({
        draft: '',
        stream: null,
        lastAcceptedRequestId: null,
      });
    });
  }

  it('drops an unresolved command and confirmation timer when history changes, without replaying it', async () => {
    vi.useFakeTimers();
    const s = setup();
    const delivery = s.submission.send(8192);
    const clearing = s.submission.clear(0);
    s.succeed();
    await clearing;
    await vi.advanceTimersByTimeAsync(16_000);
    s.execution.resolve(completed);
    await delivery;
    await s.submission.reconcile();
    expect(s.submit).toHaveBeenCalledOnce();
    expect(s.submission.getSnapshot()).toMatchObject({
      phase: 'editing',
      historyClear: { phase: 'idle' },
      draft: '',
    });
  });

  for (const cause of [
    new RequestError(403),
    new ConversationApiError(400, 'INVALID_INPUT'),
  ]) {
    it(`preserves the draft and stream after definitive initial rejection ${cause.constructor.name}`, async () => {
      const s = setup();
      const delivery = s.submission.retry(failed.turn.id, historyOf(failed));
      s.emit(retryAccepted);
      const work = s.submission.clear(0);
      s.deletion.reject(cause);
      await work;
      expect(s.submission.getSnapshot()).toMatchObject({
        draft,
        historyClear: { phase: 'idle', notice: 'rejected' },
        stream: { attemptId: retryAccepted.attempt.id },
      });
      expect(s.reader().aborted).toBe(false);
      s.execution.resolve(retryCompleted);
      await delivery;
    });
  }

  it('keeps a lost response unresolved after same-version checks and never automatically repeats deletion', async () => {
    const s = setup();
    s.deletion.reject(new TypeError('Synthetic network failure'));
    await s.submission.clear(0);
    await s.submission.checkClear();
    await s.submission.send(8192);
    expect(s.clear).toHaveBeenCalledOnce();
    expect(s.submit).not.toHaveBeenCalled();
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      historyClear: { phase: 'uncertain', input: { historyVersion: 0 } },
    });
  });

  it('settles a lost response by reading a newer history version without deleting again', async () => {
    const s = setup();
    s.deletion.reject(new TypeError('Synthetic network failure'));
    await s.submission.clear(0);
    s.refresh.mockImplementation(async () => {
      s.replaceHistory();
      return newHistory;
    });
    await s.submission.checkClear();
    expect(s.clear).toHaveBeenCalledOnce();
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      historyVersion: 1,
      historyClear: { phase: 'idle', notice: 'changed' },
    });
  });

  it('retains uncertainty on a failed check and issues no writes', async () => {
    const s = setup();
    s.deletion.reject(new TypeError('Synthetic network failure'));
    await s.submission.clear(0);
    s.refresh.mockRejectedValue(new Error('Synthetic read failure'));
    await s.submission.checkClear();
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      historyClear: { phase: 'uncertain', checkFailed: true },
    });
    expect(s.clear).toHaveBeenCalledOnce();
  });

  it('allows only explicit retry of the original clear version, including rejection of that retry', async () => {
    const s = setup();
    s.deletion.reject(new TypeError('Synthetic network failure'));
    await s.submission.clear(0);
    s.clear.mockRejectedValueOnce(new RequestError(403));
    await s.submission.retryClear();
    expect(s.clear.mock.calls.map(([input]) => input)).toEqual([
      { historyVersion: 0 },
      { historyVersion: 0 },
    ]);
    expect(s.submission.getSnapshot().historyClear.phase).toBe('uncertain');
  });

  it('requires fresh confirmation after history replacement and cannot retry against newer messages', async () => {
    const s = setup();
    s.deletion.reject(new TypeError('Synthetic network failure'));
    await s.submission.clear(0);
    const latest = { ...historyOf(completed), historyVersion: 1 };
    s.replaceHistory(latest);
    await s.submission.retryClear();
    await s.submission.clear(0);
    expect(s.clear).toHaveBeenCalledOnce();
    expect(s.submission.getSnapshot()).toMatchObject({
      historyVersion: 1,
      draft: '',
      historyClear: { phase: 'idle', notice: 'changed' },
    });
  });

  it('reloads after stale rejection without deleting the current version', async () => {
    const s = setup();
    s.deletion.reject(new ConversationApiError(409, 'STALE_HISTORY'));
    s.refresh.mockImplementation(async () => {
      s.replaceHistory();
      return newHistory;
    });
    await s.submission.clear(0);
    expect(s.clear).toHaveBeenCalledOnce();
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      historyVersion: 1,
      historyClear: { phase: 'idle', notice: 'changed' },
    });
  });

  it('does not replay delivery when its earlier recovery read finishes during clearing', async () => {
    const s = setup();
    s.submit.mockRejectedValueOnce(new TypeError('Synthetic lost admission'));
    await s.submission.send(8192);
    const read = deferred<ConversationHistory>();
    s.refresh.mockReturnValueOnce(read.promise);
    const recovery = s.submission.reconcile();
    const clearing = s.submission.clear(0);
    read.resolve(historyOf(failed));
    await recovery;
    expect(s.submit).toHaveBeenCalledOnce();
    expect(s.submission.getSnapshot().historyClear.phase).toBe('clearing');
    s.deletion.reject(new RequestError(403));
    await clearing;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'uncertain',
      historyClear: { phase: 'idle', notice: 'rejected' },
    });
  });

  it('keeps cleared text removed and offers read-only recovery if the post-clear read fails', async () => {
    const s = setup();
    s.refresh.mockRejectedValue(new Error('Synthetic read failure'));
    const work = s.submission.clear(0);
    s.deletion.resolve({ historyVersion: 1 });
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      stream: null,
      historyClear: { phase: 'refresh-failed' },
    });
    await s.submission.retryClear();
    s.refresh.mockResolvedValue(newHistory);
    await s.submission.checkClear();
    expect(s.clear).toHaveBeenCalledOnce();
    expect(s.submission.getSnapshot().historyClear.phase).toBe('idle');
  });

  it('exposes uncertain recovery after a bounded wait without claiming rollback', async () => {
    vi.useFakeTimers();
    const s = setup();
    const work = s.submission.clear(0);
    await vi.advanceTimersByTimeAsync(15_000);
    await work;
    expect(s.clear.mock.calls[0]?.[1].aborted).toBe(true);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      historyClear: { phase: 'uncertain' },
    });
    s.deletion.resolve({ historyVersion: 1 });
    await Promise.resolve();
    expect(s.submission.getSnapshot().historyClear.phase).toBe('uncertain');
  });

  it('cleans private state on session loss during clear', async () => {
    const s = setup();
    const work = s.submission.clear(0);
    s.deletion.reject(new RequestError(401));
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      historyClear: { phase: 'idle', notice: null },
    });
  });

  it('ignores a late clear result after reset or history replacement', async () => {
    const s = setup();
    const work = s.submission.clear(0);
    s.submission.reset();
    s.submission.edit('Replacement draft');
    s.deletion.resolve({ historyVersion: 1 });
    await work;
    expect(s.submission.getSnapshot().draft).toBe('Replacement draft');
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it('ignores a late history check after reset and session replacement', async () => {
    const s = setup();
    s.deletion.reject(new TypeError('Synthetic network failure'));
    await s.submission.clear(0);
    const read = deferred<ConversationHistory>();
    s.refresh.mockReturnValue(read.promise);
    const work = s.submission.checkClear();
    s.submission.reset();
    s.expire();
    read.resolve(newHistory);
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      historyClear: { phase: 'idle', notice: null },
    });
  });
});
