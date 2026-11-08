import type {
  SubmitInput,
  TurnResult,
  ConversationHistory,
} from '../../src/features/conversation/api/conversation-contracts';

export const streamInput: SubmitInput = {
  historyVersion: 0,
  requestId: '00000000-0000-4000-8000-000000000001',
  text: 'A synthetic streaming question',
};
export const running: TurnResult = {
  historyVersion: 0,
  turn: {
    id: '00000000-0000-4000-8000-000000000002',
    requestId: streamInput.requestId,
    sequence: 1,
    text: streamInput.text,
    createdAt: '2026-11-07T10:00:00.000Z',
  },
  attempt: {
    id: '00000000-0000-4000-8000-000000000003',
    turnId: '00000000-0000-4000-8000-000000000002',
    requestId: streamInput.requestId,
    attemptNumber: 1,
    model: 'synthetic-model',
    state: 'running',
    startedAt: '2026-11-07T10:00:00.000Z',
    deadlineAt: '2026-11-07T10:01:00.000Z',
    finishedAt: null,
    answer: null,
    errorCode: null,
    sources: [],
    activity: [],
    inputTokens: null,
    outputTokens: null,
    contextLimited: false,
  },
};
export const completed: TurnResult = {
  ...running,
  attempt: {
    ...running.attempt,
    state: 'completed',
    answer: 'The saved answer.',
    finishedAt: '2026-11-07T10:00:02.000Z',
    outputTokens: 5,
  },
};
export const accepted = {
  type: 'accepted' as const,
  replayed: false,
  ...running,
};
export const delta = {
  type: 'text_delta' as const,
  historyVersion: 0,
  turnId: running.turn.id,
  attemptId: running.attempt.id,
  delta: 'Hello 😀\nworld',
};
export const final = { type: 'result' as const, ...completed };
export function historyOf(result?: TurnResult): ConversationHistory {
  return {
    historyVersion: result?.historyVersion ?? 0,
    turns: result ? [{ ...result.turn, attempts: [result.attempt] }] : [],
    nextCursor: null,
  };
}
export function frame<T extends { type: string }>(event: T) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
