import { ObsoleteSessionError } from '../../auth/session-scope';
import { RequestError } from '../../../lib/api-request';
import type {
  ConversationHistory,
  SubmitInput,
  RetryInput,
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
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_RETRYABLE';

export type SubmissionFailure =
  | { kind: 'session-lost' | 'history-changed' | 'unconfirmed' }
  | { kind: 'rejected'; reason: Rejection };

type Notice =
  | {
      code: 'empty' | 'uncertain' | 'check-failed' | 'stale' | 'refresh-failed';
    }
  | { code: 'history-replaced' | 'stream-lost' }
  | { code: 'accepted-refresh-failed'; operation: DeliveryOperation['kind'] }
  | { code: 'too-long'; maxBytes: number }
  | { code: 'rejected'; reason: Rejection };

export type DeliveryOperation =
  | { readonly kind: 'send'; readonly input: Readonly<SubmitInput> }
  | {
      readonly kind: 'retry';
      readonly turnId: string;
      readonly input: Readonly<RetryInput>;
    };

export function retryableTurnId(
  history: ConversationHistory | undefined,
): string | null {
  if (
    !history ||
    history.turns.some((turn) =>
      turn.attempts.some((attempt) => attempt.state === 'running'),
    )
  )
    return null;
  const latest = history.turns.reduce<
    ConversationHistory['turns'][number] | undefined
  >(
    (current, turn) =>
      !current || turn.sequence > current.sequence ? turn : current,
    undefined,
  );
  const attempt = latest?.attempts.reduce<
    NonNullable<typeof latest>['attempts'][number] | undefined
  >(
    (current, item) =>
      !current || item.attemptNumber > current.attemptNumber ? item : current,
    undefined,
  );
  return latest &&
    (attempt?.state === 'failed' || attempt?.state === 'interrupted')
    ? latest.id
    : null;
}

type Delivery =
  | { phase: 'editing' | 'stale' | 'refreshing-history' }
  | {
      phase: 'sending' | 'uncertain' | 'checking';
      operation: DeliveryOperation;
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
  pendingRetryTurnId: string | null;
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

export function unresolvedOperation(state: SubmissionState) {
  return 'operation' in state.delivery ? state.delivery.operation : undefined;
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
  operation: DeliveryOperation,
): SubmissionState {
  return { ...state, delivery: { phase: 'sending', operation }, notice: null };
}

export function confirmAcceptance(
  state: SubmissionState,
  requestId: string,
): SubmissionState {
  const operation = unresolvedOperation(state);
  if (operation?.input.requestId !== requestId) return state;
  return {
    ...state,
    draft: operation.kind === 'send' ? '' : state.draft,
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
    ...confirmAcceptance(state, event.attempt.requestId),
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
  const operation = unresolvedOperation(state);
  return operation
    ? {
        ...state,
        delivery: { phase: 'uncertain', operation },
        notice: { code },
      }
    : state;
}

export function beginCheck(state: SubmissionState): SubmissionState {
  const operation = unresolvedOperation(state);
  return {
    ...state,
    delivery: operation
      ? { phase: 'checking', operation }
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
  const operation = unresolvedOperation(next);
  const accepted =
    !!operation &&
    history.turns.some((turn) =>
      operation.kind === 'send'
        ? turn.requestId === operation.input.requestId &&
          turn.text === operation.input.text
        : turn.id === operation.turnId &&
          turn.attempts.some(
            (attempt) =>
              attempt.requestId === operation.input.requestId &&
              attempt.attemptNumber > 1,
          ),
    );
  if (accepted) next = confirmAcceptance(next, operation.input.requestId);
  // A previous terminal attempt cannot settle a new unresolved operation.
  const settled =
    !unresolvedOperation(next) &&
    history.turns.some((turn) =>
      turn.attempts.some(
        (attempt) =>
          attempt.state !== 'running' &&
          (attempt.requestId === next.lastAcceptedRequestId ||
            attempt.id === next.stream?.attemptId),
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
      case 'NOT_FOUND':
      case 'NOT_RETRYABLE':
        return { kind: 'rejected', reason: cause.code };
    }
  }
  return { kind: 'unconfirmed' };
}

function noticeText(
  notice: Notice | null,
  operation: DeliveryOperation | undefined,
): string {
  if (!notice) return '';
  switch (notice.code) {
    case 'empty':
      return 'Write a message first.';
    case 'too-long':
      return `Your message exceeds the ${notice.maxBytes.toLocaleString()} byte limit. Shorten it and try again.`;
    case 'uncertain':
      return operation?.kind === 'retry'
        ? 'Retry delivery is uncertain. Your draft is kept below. Check or resend the retry to continue.'
        : 'Delivery is uncertain. Your message is kept below. Check or resend to continue.';
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
      return notice.operation === 'retry'
        ? 'Retry accepted. Refresh the conversation to see its response.'
        : 'Message accepted. Refresh the conversation to see its response.';
    case 'rejected':
      if (notice.reason === 'NOT_FOUND' || notice.reason === 'NOT_RETRYABLE')
        return 'This response can no longer be retried. Refresh the conversation or write a new message.';
      // Construct only browser-owned messages; never retain a caught error's text.
      return notice.reason === 'FORBIDDEN'
        ? new RequestError(403).message
        : new ConversationApiError(409, notice.reason).message;
  }
}

export function projectSnapshot(state: SubmissionState): SubmissionSnapshot {
  const operation = unresolvedOperation(state);
  return {
    draft: state.draft,
    phase:
      state.delivery.phase === 'refreshing-history'
        ? 'checking'
        : state.delivery.phase,
    error: noticeText(state.notice, operation),
    historyVersion: state.historyVersion,
    lastAcceptedRequestId: state.lastAcceptedRequestId,
    stream: state.stream,
    pendingRetryTurnId: operation?.kind === 'retry' ? operation.turnId : null,
  };
}
