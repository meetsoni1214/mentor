export type RunState = RunAttempt['state'];
export type RunErrorCode =
  | 'PROVIDER_ERROR'
  | 'REFUSED'
  | 'INCOMPLETE'
  | 'INVALID_RESPONSE'
  | 'INTERRUPTED';

export interface SourceReference {
  title: string;
  url: string;
}

export interface RunActivity {
  type: 'web_search';
  status: 'completed' | 'failed';
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type RunOutcome =
  | {
      state: 'completed';
      answer: string;
      sources: SourceReference[];
      activity: RunActivity[];
      usage: TokenUsage | null;
      contextLimited: boolean;
    }
  | { state: 'failed'; errorCode: Exclude<RunErrorCode, 'INTERRUPTED'> }
  | { state: 'interrupted'; errorCode: 'INTERRUPTED' };

interface RunAttemptDetails {
  id: string;
  turnId: string;
  requestId: string;
  attemptNumber: number;
  model: string;
  startedAt: Date;
  deadlineAt: Date;
  sources: SourceReference[];
  activity: RunActivity[];
  inputTokens: number | null;
  outputTokens: number | null;
  contextLimited: boolean;
}

export type RunAttempt = RunAttemptDetails &
  (
    | { state: 'running'; finishedAt: null; answer: null; errorCode: null }
    | { state: 'completed'; finishedAt: Date; answer: string; errorCode: null }
    | {
        state: 'failed';
        finishedAt: Date;
        answer: null;
        errorCode: Exclude<RunErrorCode, 'INTERRUPTED'>;
      }
    | {
        state: 'interrupted';
        finishedAt: Date;
        answer: null;
        errorCode: 'INTERRUPTED';
      }
  );

export interface ConversationTurn {
  id: string;
  requestId: string;
  sequence: number;
  text: string;
  createdAt: Date;
}

export type ConversationErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'STALE_HISTORY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSY'
  | 'NOT_RETRYABLE';

export class ConversationError extends Error {
  constructor(readonly code: ConversationErrorCode) {
    super(code);
  }
}

export function canFinish(state: RunState, deadline: Date, now: Date): boolean {
  return state === 'running' && deadline.getTime() > now.getTime();
}

export function assertRetryable(
  turnId: string,
  latestTurnId: string,
  state: RunState,
): void {
  if (turnId !== latestTurnId || !['failed', 'interrupted'].includes(state)) {
    throw new ConversationError('NOT_RETRYABLE');
  }
}
