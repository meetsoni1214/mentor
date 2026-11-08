import { describe, expect, it, vi } from 'vitest';
import type {
  SubmitInput,
  TurnResult,
} from '../src/features/conversation/api/conversation-contracts';
import type { ConversationStreamProgress } from '../src/features/conversation/api/conversation-stream-contracts';
import { ConversationSubmission } from '../src/features/conversation/state/conversation-submission';
import { conversationPollInterval } from '../src/features/conversation/state/conversation-polling';
import { ConversationApiError } from '../src/features/conversation/api/conversation-errors';
import {
  accepted,
  completed,
  delta,
  historyOf,
  running,
  streamInput,
} from './fixtures/conversation-stream';

function setup() {
  let emit!: (event: ConversationStreamProgress) => void;
  let signal!: AbortSignal;
  let resolve!: (result: TurnResult) => void;
  let reject!: (error: unknown) => void;
  const submit = vi.fn(
    (
      _input: SubmitInput,
      progress: typeof emit,
      requestSignal: AbortSignal,
    ) => {
      emit = progress;
      signal = requestSignal;
      return new Promise<TurnResult>((done, fail) => {
        resolve = done;
        reject = fail;
      });
    },
  );
  const refresh = vi.fn(async () => historyOf(running));
  const publish = vi.fn();
  const submission = new ConversationSubmission(
    { submit, refresh, publish, assertCurrent() {} },
    () => streamInput.requestId,
  );
  submission.observe(historyOf());
  submission.edit(streamInput.text);
  const work = submission.send(8192);
  return {
    submission,
    submit,
    refresh,
    publish,
    work,
    emit: (event: ConversationStreamProgress) => emit(event),
    resolve: (result: TurnResult) => resolve(result),
    reject: (error: unknown) => reject(error),
    signal: () => signal,
  };
}

describe('streaming acceptance, provisional display and delivery recovery', () => {
  it('clears only the submitted draft on acceptance and retains the next draft through final completion', async () => {
    const s = setup();
    s.emit(accepted);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'editing',
      stream: { text: '' },
    });
    expect(s.publish).toHaveBeenCalledWith(accepted);
    s.submission.edit('My next draft');
    s.emit(delta);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: 'My next draft',
      stream: { text: delta.delta },
    });
    await s.submission.send(8192);
    expect(s.submit).toHaveBeenCalledOnce();
    s.refresh.mockResolvedValue(historyOf(completed));
    s.resolve(completed);
    await s.work;
    expect(s.publish).toHaveBeenLastCalledWith(completed);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: 'My next draft',
      stream: null,
      phase: 'editing',
    });
  });

  it('stops the confirmation timer after acceptance and uses polling only when there is no matching live stream', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      s.emit(accepted);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(s.submission.getSnapshot().phase).toBe('editing');
      expect(s.submission.getSnapshot().error).toBe('');
      expect(
        conversationPollInterval(historyOf(running), false, running.attempt.id),
      ).toBe(false);
      expect(conversationPollInterval(historyOf(running), false)).toBe(2000);
      expect(
        conversationPollInterval(
          historyOf(running),
          false,
          streamInput.requestId,
        ),
      ).toBe(2000);
      s.resolve(completed);
      await s.work;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a stream alive when a head read confirms acceptance', async () => {
    const s = setup();
    s.submission.observe(historyOf(running));
    s.submission.edit('Next draft');
    s.emit(accepted);
    s.submission.observe(historyOf(running));
    s.emit(delta);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: 'Next draft',
      stream: { text: delta.delta },
    });
    expect(s.signal().aborted).toBe(false);
    s.resolve(completed);
    await s.work;
  });

  it('ignores an old reader even if cancellation is ignored after a new draft is sent', async () => {
    const s = setup();
    s.emit(accepted);
    s.submission.observe(historyOf(completed));
    s.submission.edit('Next draft');
    // Capture the first transport callbacks before the test port is reused.
    const oldProgress = s.submit.mock.calls[0]![1];
    s.reject(new Error('Detached reader'));
    await s.work;
    const nextWork = s.submission.send(8192);
    oldProgress(accepted);
    oldProgress(delta);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: 'Next draft',
      phase: 'sending',
      stream: null,
    });
    expect(s.submit).toHaveBeenCalledTimes(2);
    s.submission.reset();
    oldProgress(delta);
    s.reject(new Error('Test cleanup'));
    await nextWork;
  });

  it('discards provisional text on a broken stream, retains the next draft, and never automatically resends', async () => {
    const s = setup();
    s.emit(accepted);
    s.emit(delta);
    s.submission.edit('Next draft');
    s.reject(new Error('Synthetic stream break'));
    await s.work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: 'Next draft',
      stream: null,
      phase: 'editing',
    });
    expect(s.refresh).toHaveBeenCalledOnce();
    expect(s.submit).toHaveBeenCalledOnce();
    expect(conversationPollInterval(historyOf(running), false)).toBe(2000);
    s.submission.observe(historyOf(completed));
    expect(s.submission.getSnapshot().error).toBe('');
  });

  it('replaces partial text with the saved unsuccessful outcome, without saving provisional text', async () => {
    const s = setup();
    s.emit(accepted);
    s.emit(delta);
    const failed: TurnResult = {
      ...running,
      attempt: {
        ...running.attempt,
        state: 'failed',
        finishedAt: completed.attempt.finishedAt,
        errorCode: 'PROVIDER_ERROR',
      },
    };
    s.refresh.mockResolvedValue(historyOf(failed));
    s.resolve(failed);
    await s.work;
    expect(s.submission.getSnapshot().stream).toBeNull();
    expect(s.publish).toHaveBeenLastCalledWith(failed);
    expect(
      s.publish.mock.calls.every(([result]) => result.attempt.answer === null),
    ).toBe(true);
  });

  it.each(['reset', 'history change', 'terminal history'] as const)(
    'detaches and ignores late text after %s',
    async (reason) => {
      const s = setup();
      s.emit(accepted);
      s.emit(delta);
      if (reason === 'reset') s.submission.reset();
      else if (reason === 'history change')
        s.submission.observe({ ...historyOf(), historyVersion: 1 });
      else s.submission.observe(historyOf(completed));
      expect(s.signal().aborted).toBe(true);
      s.emit(delta);
      expect(s.submission.getSnapshot().stream).toBeNull();
      s.reject(new Error('Reader detached'));
      await s.work;
      expect(s.submit).toHaveBeenCalledOnce();
    },
  );

  it('handles stale-history stream errors by discarding old text and reading the new version without replay', async () => {
    const s = setup();
    s.emit(accepted);
    s.emit(delta);
    s.refresh.mockResolvedValue({ ...historyOf(), historyVersion: 1 });
    s.reject(new ConversationApiError(409, 'STALE_HISTORY'));
    await s.work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: '',
      stream: null,
      historyVersion: 1,
      phase: 'editing',
    });
    expect(s.submit).toHaveBeenCalledOnce();
  });

  it('a running replay has no provisional stream and recovers by polling saved history', async () => {
    const s = setup();
    s.emit({ ...accepted, replayed: true });
    s.resolve(running);
    await s.work;
    expect(s.submission.getSnapshot().stream).toBeNull();
    expect(conversationPollInterval(historyOf(running), false)).toBe(2000);
  });
});
