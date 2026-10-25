import { ConversationError } from './conversation.js';
import type { ConversationTurn, RunAttempt } from './conversation.js';

export function assertHistoryVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new ConversationError('STALE_HISTORY');
}

export function assertNoRunningAttempt(hasRunningAttempt: boolean): void {
  if (hasRunningAttempt) throw new ConversationError('BUSY');
}

type SubmissionDecision =
  { kind: 'replay'; turn: ConversationTurn } | { kind: 'start' };

export function decideSubmission(
  text: string,
  state: {
    existingTurn: ConversationTurn | null;
    requestIdInUse: boolean;
    hasRunningAttempt: boolean;
  },
): SubmissionDecision {
  if (state.existingTurn) {
    if (state.existingTurn.text !== text)
      throw new ConversationError('IDEMPOTENCY_CONFLICT');
    // Replays inspect accepted work even when another attempt is running.
    return { kind: 'replay', turn: state.existingTurn };
  }
  if (state.requestIdInUse) throw new ConversationError('IDEMPOTENCY_CONFLICT');
  assertNoRunningAttempt(state.hasRunningAttempt);
  return { kind: 'start' };
}

export function replayRetry(
  turnId: string,
  existingAttempt: RunAttempt | null,
): RunAttempt | null {
  if (!existingAttempt) return null;
  // Initial submission identifiers are not retry identifiers. An accepted
  // retry remains replayable after it finishes or newer messages arrive.
  if (existingAttempt.turnId !== turnId || existingAttempt.attemptNumber === 1)
    throw new ConversationError('IDEMPOTENCY_CONFLICT');
  return existingAttempt;
}
