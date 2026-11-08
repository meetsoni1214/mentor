import type {
  Admission,
  ConversationTurn,
  RunAttempt,
} from '@mentor/backend/conversation';
import type {
  ConversationTurnDto,
  RunAttemptDto,
  TurnResultDto,
} from './conversation.dto.js';

export function describeTurn(turn: ConversationTurn): ConversationTurnDto {
  return {
    id: turn.id,
    requestId: turn.requestId,
    sequence: turn.sequence,
    text: turn.text,
    createdAt: turn.createdAt.toISOString(),
  };
}

export function describeAttempt(attempt: RunAttempt): RunAttemptDto {
  return {
    id: attempt.id,
    turnId: attempt.turnId,
    requestId: attempt.requestId,
    attemptNumber: attempt.attemptNumber,
    model: attempt.model,
    state: attempt.state,
    startedAt: attempt.startedAt.toISOString(),
    deadlineAt: attempt.deadlineAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
    answer: attempt.answer,
    errorCode: attempt.errorCode,
    sources: attempt.sources.map(({ title, url, startIndex, endIndex }) => ({
      title,
      url,
      ...(startIndex === undefined ? {} : { startIndex }),
      ...(endIndex === undefined ? {} : { endIndex }),
    })),
    activity: attempt.activity.map(({ type, status }) => ({ type, status })),
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    contextLimited: attempt.contextLimited,
  };
}

export function describeResult(result: Admission): TurnResultDto {
  return {
    historyVersion: result.historyVersion,
    turn: describeTurn(result.turn),
    attempt: describeAttempt(result.attempt),
  };
}
