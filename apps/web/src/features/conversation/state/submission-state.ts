import { ObsoleteSessionError } from '../../auth/session-scope';
import { RequestError } from '../../../lib/api-request';
import type {
  ConversationHistory,
  SubmitInput,
} from '../api/conversation-contracts';
import { ConversationApiError } from '../api/conversation-errors';
import type {
  ConversationStreamProgress,
  ProvisionalResponse,
} from '../api/conversation-stream-contracts';
import { ObsoleteHistoryError } from './conversation-scope';

type Rejection =
  | 'BUSY'
  | 'EXECUTION_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'FORBIDDEN';

export type SubmissionFailure =
  | { kind: 'session-lost' | 'history-changed' | 'unconfirmed' }
  | { kind: 'rejected'; reason: Rejection };

type Notice =
  | {
      code: 'empty' | 'uncertain' | 'check-failed' | 'stale' | 'refresh-failed';
    }
  | { code: 'history-replaced' | 'stream-lost' | 'accepted-refresh-failed' }
  | { code: 'too-long'; maxBytes: number }
  | { code: 'rejected'; reason: Rejection };

type Delivery =
  | { phase: 'editing' | 'stale' | 'refreshing-history' }
  | {
      phase: 'sending' | 'uncertain' | 'checking';
      input: Readonly<SubmitInput>;
    };

export interface SubmissionState {
  readonly draft: string;
  readonly delivery: Delivery;
  readonly notice: Notice | null;
  readonly historyVersion: number | undefined;
  readonly lastAcceptedRequestId: string | null;
  readonly stream: ProvisionalResponse | null;
}

export interface SubmissionSnapshot {
  draft: string;
  phase: 'editing' | 'sending' | 'uncertain' | 'checking' | 'stale';
  error: string;
  historyVersion: number | undefined;
  lastAcceptedRequestId: string | null;
  stream: ProvisionalResponse | null;
}

export function initialState(historyVersion?: number): SubmissionState {
  return {
    draft: '',
    delivery: { phase: 'editing' },
    notice: null,
    historyVersion,
    lastAcceptedRequestId: null,
    stream: null,
  };
}

export function unresolvedInput(state: SubmissionState) {
  return 'input' in state.delivery ? state.delivery.input : undefined;
}

export function editDraft(
  state: SubmissionState,
  draft: string,
): SubmissionState {
  return state.delivery.phase === 'editing' &&
    (state.draft !== draft || state.notice !== null)
    ? { ...state, draft, notice: null }
    : state;
}

export function validateDraft(draft: string, maxBytes: number): Notice | null {
  if (!draft.trim()) return { code: 'empty' };
  return new TextEncoder().encode(draft).length > maxBytes
    ? { code: 'too-long', maxBytes }
    : null;
}

export function beginDelivery(
  state: SubmissionState,
  input: Readonly<SubmitInput>,
): SubmissionState {
  return { ...state, delivery: { phase: 'sending', input }, notice: null };
}

export function confirmAcceptance(
  state: SubmissionState,
  requestId: string,
): SubmissionState {
  if (unresolvedInput(state)?.requestId !== requestId) return state;
  return {
    ...state,
    draft: '',
    delivery: { phase: 'editing' },
    notice: null,
    lastAcceptedRequestId: requestId,
  };
}

export function receiveAcceptance(
  state: SubmissionState,
  event: Extract<ConversationStreamProgress, { type: 'accepted' }>,
): SubmissionState {
  return {
    ...confirmAcceptance(state, event.turn.requestId),
    stream:
      !event.replayed && event.attempt.state === 'running'
        ? {
            historyVersion: event.historyVersion,
            turnId: event.turn.id,
            attemptId: event.attempt.id,
            text: '',
          }
        : null,
  };
}

export function appendText(
  state: SubmissionState,
  delta: string,
): SubmissionState {
  return state.stream
    ? { ...state, stream: { ...state.stream, text: state.stream.text + delta } }
    : state;
}

export function finishResponse(state: SubmissionState): SubmissionState {
  return state.stream ? { ...state, stream: null } : state;
}

export function loseStream(
  state: SubmissionState,
  notice: 'stream-lost' | null,
): SubmissionState {
  return {
    ...state,
    stream: null,
    notice: notice ? { code: notice } : state.notice,
  };
}

export function rejectDelivery(
  state: SubmissionState,
  reason: Rejection,
): SubmissionState {
  return {
    ...state,
    delivery: { phase: 'editing' },
    notice: { code: 'rejected', reason },
  };
}

export function markUncertain(
  state: SubmissionState,
  code: 'uncertain' | 'check-failed' = 'uncertain',
): SubmissionState {
  const input = unresolvedInput(state);
  return input
    ? { ...state, delivery: { phase: 'uncertain', input }, notice: { code } }
    : state;
}

export function beginCheck(state: SubmissionState): SubmissionState {
  const input = unresolvedInput(state);
  return {
    ...state,
    delivery: input
      ? { phase: 'checking', input }
      : { phase: 'refreshing-history' },
    notice: null,
  };
}

export function failHistoryCheck(state: SubmissionState): SubmissionState {
  return state.delivery.phase === 'refreshing-history'
    ? {
        ...state,
        delivery: { phase: 'stale' },
        notice: { code: 'refresh-failed' },
      }
    : markUncertain(state, 'check-failed');
}

export function reportNotice(
  state: SubmissionState,
  notice: Notice,
): SubmissionState {
  return { ...state, notice };
}

export function invalidateHistory(state: SubmissionState): SubmissionState {
  return {
    ...state,
    draft: '',
    delivery: { phase: 'stale' },
    stream: null,
    notice: { code: 'stale' },
  };
}

export function observeHistory(
  state: SubmissionState,
  history: ConversationHistory,
) {
  const historyChanged =
    state.historyVersion !== undefined &&
    state.historyVersion !== history.historyVersion;
  let next = historyChanged
    ? {
        ...initialState(history.historyVersion),
        notice: { code: 'history-replaced' } as const,
      }
    : state.historyVersion === undefined
      ? { ...state, historyVersion: history.historyVersion }
      : state;
  const input = unresolvedInput(next);
  const accepted =
    !!input &&
    history.turns.some(
      (turn) => turn.requestId === input.requestId && turn.text === input.text,
    );
  if (accepted) next = confirmAcceptance(next, input.requestId);
  const settled = history.turns.some(
    (turn) =>
      (turn.requestId === next.lastAcceptedRequestId &&
        turn.attempts.length > 0 &&
        turn.attempts.every((attempt) => attempt.state !== 'running')) ||
      turn.attempts.some(
        (attempt) =>
          attempt.id === next.stream?.attemptId && attempt.state !== 'running',
      ),
  );
  if (settled && (next.stream || next.notice?.code === 'stream-lost'))
    next = {
      ...next,
      stream: null,
      notice: next.notice?.code === 'stream-lost' ? null : next.notice,
    };
  return { state: next, historyChanged, accepted, settled };
}

export function classifyFailure(cause: unknown): SubmissionFailure {
  if (
    cause instanceof ObsoleteSessionError ||
    (cause instanceof RequestError && cause.status === 401)
  )
    return { kind: 'session-lost' };
  if (
    cause instanceof ObsoleteHistoryError ||
    (cause instanceof ConversationApiError && cause.code === 'STALE_HISTORY')
  )
    return { kind: 'history-changed' };
  if (cause instanceof RequestError && cause.status === 403)
    return { kind: 'rejected', reason: 'FORBIDDEN' };
  if (cause instanceof ConversationApiError) {
    switch (cause.code) {
      case 'BUSY':
      case 'EXECUTION_UNAVAILABLE':
      case 'INVALID_INPUT':
      case 'IDEMPOTENCY_CONFLICT':
        return { kind: 'rejected', reason: cause.code };
    }
  }
  return { kind: 'unconfirmed' };
}

function noticeText(notice: Notice | null): string {
  if (!notice) return '';
  switch (notice.code) {
    case 'empty':
      return 'Write a message first.';
    case 'too-long':
      return `Your message exceeds the ${notice.maxBytes.toLocaleString()} byte limit. Shorten it and try again.`;
    case 'uncertain':
      return 'Delivery is uncertain. Your message is kept below. Check or resend to continue.';
    case 'check-failed':
      return 'Delivery could not be checked. Check your connection and try again.';
    case 'stale':
      return 'History changed. Refresh before writing another message.';
    case 'refresh-failed':
      return 'History could not be refreshed. Try again before writing another message.';
    case 'history-replaced':
      return 'History changed. Your previous draft was cleared.';
    case 'stream-lost':
      return 'The live response stopped. Checking the saved response…';
    case 'accepted-refresh-failed':
      return 'Message accepted. Refresh the conversation to see its response.';
    case 'rejected':
      // Construct only browser-owned messages; never retain a caught error's text.
      return notice.reason === 'FORBIDDEN'
        ? new RequestError(403).message
        : new ConversationApiError(409, notice.reason).message;
  }
}

export function projectSnapshot(state: SubmissionState): SubmissionSnapshot {
  return {
    draft: state.draft,
    phase:
      state.delivery.phase === 'refreshing-history'
        ? 'checking'
        : state.delivery.phase,
    error: noticeText(state.notice),
    historyVersion: state.historyVersion,
    lastAcceptedRequestId: state.lastAcceptedRequestId,
    stream: state.stream,
  };
}
