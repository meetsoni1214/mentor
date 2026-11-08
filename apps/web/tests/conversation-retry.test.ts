import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationHistory,
  RetryInput,
  TurnResult,
} from '../src/features/conversation/api/conversation-contracts';
import type { ConversationStreamProgress } from '../src/features/conversation/api/conversation-stream-contracts';
import { ConversationApiError } from '../src/features/conversation/api/conversation-errors';
import { RequestError } from '../src/lib/api-request';
import { ConversationSubmission } from '../src/features/conversation/state/conversation-submission';
import { retryableTurnId } from '../src/features/conversation/state/submission-state';
import { conversationPollInterval } from '../src/features/conversation/state/conversation-polling';
import {
  failed,
  completed,
  historyOf,
  retryInput,
  retryRunning,
  retryCompleted,
  retryAccepted,
  retryDelta,
  retryHistoryOf,
} from './fixtures/conversation-stream';

const draft = 'Keep this independent draft';
function setup() {
  let emit!: (event: ConversationStreamProgress) => void;
  let signal!: AbortSignal;
  let resolve!: (value: TurnResult) => void;
  let reject!: (cause: unknown) => void;
  const retry = vi.fn(
    (
      _turnId: string,
      _input: RetryInput,
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
  const submit = vi.fn();
  const refresh = vi
    .fn<() => Promise<ConversationHistory>>()
    .mockResolvedValue(historyOf(failed));
  const publish = vi.fn<(result: TurnResult) => void>();
  const requestId = vi.fn(() => retryInput.requestId);
  const submission = new ConversationSubmission(
    { retry, submit, clear: vi.fn(), refresh, publish, assertCurrent() {} },
    requestId,
  );
  submission.observe(historyOf(failed));
  submission.edit(draft);
  const start = () => submission.retry(failed.turn.id, historyOf(failed));
  return {
    submission,
    start,
    retry,
    submit,
    refresh,
    publish,
    requestId,
    emit: (event: ConversationStreamProgress) => emit(event),
    resolve: (value: TurnResult) => resolve(value),
    reject: (cause: unknown) => reject(cause),
    signal: () => signal,
  };
}
afterEach(() => vi.useRealTimers());

describe('explicit response retry and delivery recovery', () => {
  it('does not settle a new retry from the previously accepted failed attempt on the same turn', async () => {
    const s = setup();
    s.requestId.mockReturnValueOnce(failed.turn.requestId);
    s.submit.mockResolvedValueOnce(failed);
    await s.submission.send(8192);
    expect(s.submission.getSnapshot().lastAcceptedRequestId).toBe(
      failed.turn.requestId,
    );
    s.submission.edit(draft);
    const work = s.start();
    s.submission.observe(historyOf(failed));
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'sending',
    });
    expect(s.signal().aborted).toBe(false);
    s.emit(retryAccepted);
    s.resolve(retryCompleted);
    await work;
    expect(s.submission.getSnapshot().draft).toBe(draft);
  });
  it('blocks duplicate retry and send before awaiting admission, preserving the independent draft', async () => {
    const s = setup();
    const work = s.start();
    await s.start();
    await s.submission.send(8192);
    expect(s.retry).toHaveBeenCalledExactlyOnceWith(
      failed.turn.id,
      retryInput,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(s.requestId).toHaveBeenCalledOnce();
    expect(s.submit).not.toHaveBeenCalled();
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'sending',
      pendingRetryTurnId: failed.turn.id,
    });
    s.resolve(retryCompleted);
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'editing',
      pendingRetryTurnId: null,
    });
  });

  it('streams retry text and preserves both the initial and edited draft through completion and duplicate confirmation', async () => {
    const s = setup();
    const work = s.start();
    s.emit(retryAccepted);
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'editing',
      lastAcceptedRequestId: retryInput.requestId,
    });
    s.emit(retryDelta);
    expect(s.submission.getSnapshot().stream?.text).toBe(retryDelta.delta);
    expect(
      conversationPollInterval(
        retryHistoryOf(),
        false,
        retryRunning.attempt.id,
      ),
    ).toBe(false);
    s.submission.edit('Next draft after acceptance');
    s.emit(retryAccepted);
    s.refresh.mockResolvedValue(retryHistoryOf(retryCompleted));
    s.resolve(retryCompleted);
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: 'Next draft after acceptance',
      stream: null,
      error: '',
    });
    expect(s.publish).toHaveBeenLastCalledWith(retryCompleted);
  });

  it('only confirms and settles the matching retry attempt, retaining a healthy reader after history acceptance', async () => {
    const s = setup();
    const work = s.start();
    s.submission.observe(historyOf(failed));
    expect(s.submission.getSnapshot().phase).toBe('sending');
    expect(s.signal().aborted).toBe(false);
    s.submission.observe(retryHistoryOf());
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'editing',
    });
    s.emit(retryAccepted);
    s.submission.observe(retryHistoryOf());
    s.emit(retryDelta);
    expect(s.signal().aborted).toBe(false);
    expect(s.submission.getSnapshot().stream?.text).toBe(retryDelta.delta);
    s.submission.observe(retryHistoryOf(retryCompleted));
    expect(s.signal().aborted).toBe(true);
    s.emit(retryDelta);
    expect(s.submission.getSnapshot()).toMatchObject({ draft, stream: null });
    s.resolve(retryCompleted);
    await work;
  });

  it('retains the exact retry identity after loss and never replays after an unsuccessful history check', async () => {
    const s = setup();
    const work = s.start();
    s.reject(new Error('Lost confirmation'));
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'uncertain',
    });
    expect(s.submission.getSnapshot().error).toContain('Retry delivery');
    s.refresh.mockRejectedValueOnce(new Error('Offline'));
    await s.submission.reconcile();
    expect(s.retry).toHaveBeenCalledOnce();
    s.retry.mockResolvedValueOnce(retryCompleted);
    s.refresh.mockResolvedValue(retryHistoryOf(retryCompleted));
    await s.submission.reconcile();
    expect(s.retry).toHaveBeenCalledOnce(); // History confirms; no replay is necessary.
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'editing',
      error: '',
    });
  });

  it.each([
    'BUSY',
    'NOT_RETRYABLE',
    'NOT_FOUND',
    'EXECUTION_UNAVAILABLE',
    'INVALID_INPUT',
    'FORBIDDEN',
  ] as const)(
    'keeps the original retry key after an inconclusive explicit resend failure: %s',
    async (code) => {
      const s = setup();
      const work = s.start();
      s.reject(new Error('Lost confirmation'));
      await work;
      s.retry.mockRejectedValueOnce(
        code === 'FORBIDDEN'
          ? new RequestError(403)
          : new ConversationApiError(409, code),
      );
      await s.submission.reconcile();
      expect(s.submission.getSnapshot()).toMatchObject({
        draft,
        phase: 'uncertain',
      });
      s.retry.mockResolvedValueOnce(retryCompleted);
      await s.submission.reconcile();
      expect(
        s.retry.mock.calls.map(([turnId, input]) => ({ turnId, input })),
      ).toEqual(Array(3).fill({ turnId: failed.turn.id, input: retryInput }));
      expect(s.requestId).toHaveBeenCalledOnce();
      expect(s.submit).not.toHaveBeenCalled();
      expect(s.submission.getSnapshot()).toMatchObject({
        draft,
        phase: 'editing',
      });
    },
  );

  it.each([
    'BUSY',
    'NOT_RETRYABLE',
    'NOT_FOUND',
    'EXECUTION_UNAVAILABLE',
    'IDEMPOTENCY_CONFLICT',
  ] as const)(
    'preserves the draft after an initial rejected retry: %s',
    async (code) => {
      const s = setup();
      const work = s.start();
      s.reject(new ConversationApiError(409, code));
      await work;
      expect(s.submission.getSnapshot()).toMatchObject({
        draft,
        phase: 'editing',
        pendingRetryTurnId: null,
      });
      expect(s.retry).toHaveBeenCalledOnce();
      if (code === 'NOT_RETRYABLE' || code === 'NOT_FOUND')
        expect(s.submission.getSnapshot().error).toContain(
          'write a new message',
        );
    },
  );

  it('ends uncertain recovery on a definitive request-key conflict without clearing the draft', async () => {
    const s = setup();
    const work = s.start();
    s.reject(new Error('Lost'));
    await work;
    s.retry.mockRejectedValueOnce(
      new ConversationApiError(409, 'IDEMPOTENCY_CONFLICT'),
    );
    await s.submission.reconcile();
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'editing',
      pendingRetryTurnId: null,
    });
  });

  it('exposes recovery after the confirmation timeout and accepts later history without another POST', async () => {
    vi.useFakeTimers();
    const s = setup();
    const work = s.start();
    await vi.advanceTimersByTimeAsync(15_001);
    await work;
    expect(s.submission.getSnapshot().phase).toBe('uncertain');
    s.submission.observe(retryHistoryOf());
    expect(s.submission.getSnapshot()).toMatchObject({
      draft,
      phase: 'editing',
      lastAcceptedRequestId: retryInput.requestId,
    });
    expect(s.retry).toHaveBeenCalledOnce();
  });

  it('recovers a disconnected retry through saved history while retaining the next draft', async () => {
    const s = setup();
    const work = s.start();
    s.emit(retryAccepted);
    s.emit(retryDelta);
    s.submission.edit('Next draft');
    s.refresh.mockResolvedValue(retryHistoryOf());
    s.reject(new Error('Disconnected'));
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({
      draft: 'Next draft',
      stream: null,
      phase: 'editing',
    });
    expect(conversationPollInterval(retryHistoryOf(), false)).toBe(2000);
    s.submission.observe(retryHistoryOf(retryCompleted));
    expect(s.submission.getSnapshot().error).toBe('');
    expect(s.retry).toHaveBeenCalledOnce();
  });

  it('replaces provisional text with a failed retry without saving partial text or clearing drafts', async () => {
    const s = setup();
    const work = s.start();
    s.emit(retryAccepted);
    s.emit(retryDelta);
    const retryFailed: TurnResult = {
      ...retryRunning,
      attempt: {
        ...retryRunning.attempt,
        state: 'failed',
        errorCode: 'INCOMPLETE',
        finishedAt: retryCompleted.attempt.finishedAt,
      },
    };
    s.refresh.mockResolvedValue(retryHistoryOf(retryFailed));
    s.resolve(retryFailed);
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({ draft, stream: null });
    expect(s.publish).toHaveBeenLastCalledWith(retryFailed);
    expect(
      s.publish.mock.calls.every(([value]) => value.attempt.answer === null),
    ).toBe(true);
  });

  it('treats a running retry replay as saved state without a live text attachment', async () => {
    const s = setup();
    const work = s.start();
    s.emit({ ...retryAccepted, replayed: true });
    s.refresh.mockResolvedValue(retryHistoryOf());
    s.resolve(retryRunning);
    await work;
    expect(s.submission.getSnapshot()).toMatchObject({ draft, stream: null });
    expect(conversationPollInterval(retryHistoryOf(), false)).toBe(2000);
  });

  it.each(['reset', 'history', '401', 'stale-error'] as const)(
    'clears private retry state and suppresses late events after %s',
    async (reason) => {
      const s = setup();
      const work = s.start();
      s.emit(retryAccepted);
      s.emit(retryDelta);
      if (reason === 'reset') s.submission.reset();
      else if (reason === 'history')
        s.submission.observe({ ...historyOf(), historyVersion: 1 });
      else {
        if (reason === 'stale-error')
          s.refresh.mockResolvedValue({ ...historyOf(), historyVersion: 1 });
        s.reject(
          reason === '401'
            ? new RequestError(401)
            : new ConversationApiError(409, 'STALE_HISTORY'),
        );
        await work;
      }
      const publications = s.publish.mock.calls.length;
      s.emit(retryAccepted);
      s.emit(retryDelta);
      s.resolve(retryCompleted);
      await work;
      expect(s.signal().aborted).toBe(true);
      expect(s.submission.getSnapshot()).toMatchObject({
        draft: '',
        stream: null,
        pendingRetryTurnId: null,
      });
      expect(s.publish).toHaveBeenCalledTimes(publications);
      expect(s.retry).toHaveBeenCalledOnce();
    },
  );

  it('only offers retry for the newest failed or interrupted attempt', () => {
    expect(retryableTurnId(historyOf(failed))).toBe(failed.turn.id);
    expect(
      retryableTurnId(
        historyOf({
          ...failed,
          attempt: {
            ...failed.attempt,
            state: 'interrupted',
            errorCode: 'INTERRUPTED',
          },
        }),
      ),
    ).toBe(failed.turn.id);
    expect(retryableTurnId(historyOf(completed))).toBeNull();
    expect(retryableTurnId(retryHistoryOf())).toBeNull();
    expect(
      retryableTurnId({
        ...historyOf(failed),
        turns: [
          historyOf(failed).turns[0]!,
          {
            ...completed.turn,
            id: 'newer',
            sequence: 2,
            attempts: [completed.attempt],
          },
        ],
      }),
    ).toBeNull();
  });
});
