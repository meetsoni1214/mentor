import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ObsoleteSessionError } from '../src/features/auth/session-scope.js';
import { RequestError } from '../src/lib/api-request.js';
import type {
  ConversationHistory,
  SubmitInput,
  TurnResult,
} from '../src/features/conversation/conversation-contracts.js';
import { ConversationApiError } from '../src/features/conversation/conversation-errors.js';
import { ConversationSubmission } from '../src/features/conversation/conversation-submission.js';
import { ObsoleteHistoryError } from '../src/features/conversation/conversation-scope.js';
import { conversationPollInterval } from '../src/features/conversation/conversation-polling.js';

const empty: ConversationHistory = {
  historyVersion: 0,
  turns: [],
  nextCursor: null,
};
const text = '  A synthetic question\nwith a second line.  ';
function result(
  input: SubmitInput,
  state: 'running' | 'completed' = 'completed',
): TurnResult {
  const turn = {
    id: randomUUID(),
    requestId: input.requestId,
    text: input.text,
    sequence: 1,
    createdAt: '2026-11-01T10:00:00.000Z',
  };
  return {
    historyVersion: input.historyVersion,
    turn,
    attempt: {
      id: randomUUID(),
      turnId: turn.id,
      requestId: input.requestId,
      attemptNumber: 1,
      model: 'synthetic-model',
      state,
      startedAt: turn.createdAt,
      deadlineAt: '2026-11-01T10:01:00.000Z',
      finishedAt: state === 'running' ? null : turn.createdAt,
      answer: state === 'running' ? null : 'A synthetic answer.',
      errorCode: null,
      sources: [],
      activity: [],
      inputTokens: null,
      outputTokens: 0,
      contextLimited: false,
    },
  };
}
function history(value: TurnResult): ConversationHistory {
  return {
    historyVersion: value.historyVersion,
    turns: [{ ...value.turn, attempts: [value.attempt] }],
    nextCursor: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup() {
  const submit = vi.fn<(input: SubmitInput) => Promise<TurnResult>>();
  const refresh = vi
    .fn<() => Promise<ConversationHistory>>()
    .mockResolvedValue(empty);
  const assertCurrent = vi.fn<(version?: number) => void>();
  const requestId = vi.fn(() => randomUUID());
  const submission = new ConversationSubmission(
    { submit, refresh, assertCurrent },
    requestId,
  );
  submission.observe(empty);
  submission.edit(text);
  return { submission, submit, refresh, assertCurrent, requestId };
}

describe('conversation delivery and draft recovery', () => {
  it('discards the draft if history becomes obsolete immediately before publishing a POST result', async () => {
    const { submission, submit, assertCurrent } = setup();
    const pending = deferred<TurnResult>();
    submit.mockReturnValue(pending.promise);
    const sending = submission.send(8192);
    assertCurrent.mockImplementation((version) => {
      if (version === 0) throw new ObsoleteHistoryError();
    });
    pending.resolve(result(submit.mock.calls[0]![0]));
    await sending;
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'stale',
      lastAcceptedRequestId: null,
    });
    submission.observe({ ...empty, historyVersion: 1 });
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'editing',
      historyVersion: 1,
    });
  });
  it('lets the owner recover a hung POST without changing its request identity', async () => {
    vi.useFakeTimers();
    try {
      const { submission, submit, refresh, requestId } = setup();
      const pending = deferred<TurnResult>();
      submit.mockReturnValueOnce(pending.promise);
      const sending = submission.send(8192);
      await vi.advanceTimersByTimeAsync(15_000);
      await sending;
      expect(submission.getSnapshot()).toMatchObject({
        draft: text,
        phase: 'uncertain',
      });
      expect(submit).toHaveBeenCalledTimes(1);
      submit.mockImplementation(async (input) => {
        const accepted = result(input);
        refresh.mockResolvedValue(history(accepted));
        return accepted;
      });
      await submission.reconcile();
      pending.resolve(result(submit.mock.calls[0]![0]));
      expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
      expect(requestId).toHaveBeenCalledTimes(1);
      expect(submission.getSnapshot().draft).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps the exact draft while sending, prevents double submission, and clears only after acceptance', async () => {
    const { submission, submit, refresh } = setup();
    const pending = deferred<TurnResult>();
    submit.mockReturnValue(pending.promise);
    const sending = submission.send(8192);
    expect(submission.getSnapshot()).toMatchObject({
      draft: text,
      phase: 'sending',
    });
    submission.edit('An edit while delivery is pending');
    await submission.send(8192);
    expect(submit).toHaveBeenCalledTimes(1);
    const input = submit.mock.calls[0]![0];
    expect(input.text).toBe(text);
    const accepted = result(input);
    refresh.mockResolvedValue(history(accepted));
    pending.resolve(accepted);
    await sending;
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'editing',
      lastAcceptedRequestId: input.requestId,
    });
  });

  it.each(['BUSY', 'EXECUTION_UNAVAILABLE', 'INVALID_INPUT'] as const)(
    'preserves an editable draft after known %s rejection',
    async (code) => {
      const { submission, submit } = setup();
      submit.mockRejectedValue(new ConversationApiError(409, code));
      await submission.send(8192);
      expect(submission.getSnapshot()).toMatchObject({
        draft: text,
        phase: 'editing',
      });
      expect(submission.getSnapshot().error).toBeTruthy();
      submission.edit('A revised draft');
      expect(submission.getSnapshot().draft).toBe('A revised draft');
    },
  );

  it('validates UTF-8 bytes and blank text before allocating an identity or making a request', async () => {
    const { submission, submit, requestId } = setup();
    submission.edit('😀😀');
    await submission.send(7);
    expect(submission.getSnapshot().draft).toBe('😀😀');
    expect(submission.getSnapshot().error).toContain('byte limit');
    submission.edit(' \n ');
    await submission.send(8192);
    expect(submission.getSnapshot().error).toBe('Write a message first.');
    expect(submit).not.toHaveBeenCalled();
    expect(requestId).not.toHaveBeenCalled();
  });

  it('reconciles a dropped response through history without replaying a write', async () => {
    const { submission, submit, refresh } = setup();
    submit.mockImplementation(async (input) => {
      refresh.mockResolvedValue(history(result(input, 'running')));
      throw new TypeError('Synthetic connection loss');
    });
    await submission.send(8192);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'editing',
    });
  });

  it('retains identity and payload across explicit resends and later unavailable responses', async () => {
    const { submission, submit, requestId } = setup();
    submit.mockRejectedValueOnce(new RequestError(503));
    await submission.send(8192);
    expect(submission.getSnapshot()).toMatchObject({
      draft: text,
      phase: 'uncertain',
    });
    submission.edit('Must not replace uncertain input');
    await submission.send(8192);
    expect(submit).toHaveBeenCalledTimes(1);
    submit.mockRejectedValueOnce(
      new ConversationApiError(503, 'EXECUTION_UNAVAILABLE'),
    );
    await submission.reconcile();
    expect(submission.getSnapshot().phase).toBe('uncertain');
    submit.mockImplementation(async (input) => result(input));
    await submission.reconcile();
    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit.mock.calls.map(([input]) => input)).toEqual(
      Array(3).fill(submit.mock.calls[0]![0]),
    );
    expect(requestId).toHaveBeenCalledTimes(1);
    expect(submission.getSnapshot().draft).toBe('');
  });

  it('never resends when a delivery check cannot read current history', async () => {
    const { submission, submit, refresh } = setup();
    submit.mockRejectedValue(new TypeError('Synthetic network failure'));
    refresh.mockRejectedValue(new TypeError('Synthetic read failure'));
    await submission.send(8192);
    await submission.reconcile();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submission.getSnapshot()).toMatchObject({
      draft: text,
      phase: 'uncertain',
    });
  });

  it('allows the next draft after polling confirms acceptance and ignores the older POST failure', async () => {
    const { submission, submit } = setup();
    const pending = deferred<TurnResult>();
    submit.mockReturnValue(pending.promise);
    const sending = submission.send(8192);
    submission.observe(history(result(submit.mock.calls[0]![0], 'running')));
    submission.edit('The next draft');
    pending.reject(new TypeError('Late synthetic connection loss'));
    await sending;
    expect(submission.getSnapshot()).toMatchObject({
      draft: 'The next draft',
      phase: 'editing',
      error: '',
    });
  });

  it('clears old input and ignores late completion when a newer history version arrives', async () => {
    const { submission, submit } = setup();
    const pending = deferred<TurnResult>();
    submit.mockReturnValue(pending.promise);
    const sending = submission.send(8192);
    submission.observe({ ...empty, historyVersion: 1 });
    pending.resolve(result(submit.mock.calls[0]![0]));
    await sending;
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      historyVersion: 1,
      phase: 'editing',
      lastAcceptedRequestId: null,
    });
    await submission.reconcile();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('refreshes a stale submission without replaying it against the new version', async () => {
    const { submission, submit, refresh } = setup();
    submit.mockRejectedValue(new ConversationApiError(409, 'STALE_HISTORY'));
    refresh.mockRejectedValueOnce(new TypeError('Synthetic read failure'));
    await submission.send(8192);
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'stale',
    });
    refresh.mockResolvedValue({ ...empty, historyVersion: 1 });
    await submission.reconcile();
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'editing',
      historyVersion: 1,
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('does not interpret a later page that lacks the request as proof of failed delivery', async () => {
    const { submission, submit } = setup();
    submit.mockRejectedValue(new RequestError(502));
    await submission.send(8192);
    submission.observe(empty);
    expect(submission.getSnapshot()).toMatchObject({
      draft: text,
      phase: 'uncertain',
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('clears private text on session loss and prevents an old response from restoring it', async () => {
    const { submission, submit, assertCurrent, refresh } = setup();
    const pending = deferred<TurnResult>();
    submit.mockReturnValue(pending.promise);
    const sending = submission.send(8192);
    assertCurrent.mockImplementation(() => {
      throw new ObsoleteSessionError();
    });
    submission.reset();
    pending.resolve(result(submit.mock.calls[0]![0]));
    await sending;
    expect(submission.getSnapshot()).toMatchObject({
      draft: '',
      phase: 'editing',
      lastAcceptedRequestId: null,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the next draft if a confirmed submission is followed by a failed history refresh', async () => {
    const { submission, submit, refresh } = setup();
    const reading = deferred<ConversationHistory>();
    submit.mockImplementation(async (input) => result(input));
    refresh.mockReturnValue(reading.promise);
    const sending = submission.send(8192);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    submission.edit('The next draft');
    reading.reject(new TypeError('Synthetic read failure'));
    await sending;
    expect(submission.getSnapshot().draft).toBe('The next draft');
    expect(submission.getSnapshot().error).toContain('Message accepted');
  });
});

describe('conversation polling policy', () => {
  it('polls unresolved delivery and restored running attempts, and stops on terminal history', () => {
    const value = result(
      { text, requestId: randomUUID(), historyVersion: 0 },
      'running',
    );
    expect(conversationPollInterval(empty, true)).toBe(2000);
    expect(conversationPollInterval(history(value), false)).toBe(2000);
    expect(conversationPollInterval(empty, false)).toBe(false);
    expect(
      conversationPollInterval(
        history({
          ...value,
          attempt: {
            ...value.attempt,
            state: 'completed',
            answer: 'Synthetic answer',
            finishedAt: value.turn.createdAt,
          },
        }),
        false,
      ),
    ).toBe(false);
  });
});
