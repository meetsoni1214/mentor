import type { ConversationHistory } from '../api/conversation-contracts';

export function hasRunningAttempt(history: ConversationHistory | undefined) {
  return (
    history?.turns.some((turn) =>
      turn.attempts.some((attempt) => attempt.state === 'running'),
    ) ?? false
  );
}

export function conversationPollInterval(
  history: ConversationHistory | undefined,
  deliveryPending: boolean,
  liveAttemptId?: string,
) {
  const needsRecovery = history?.turns.some((turn) =>
    turn.attempts.some(
      (attempt) => attempt.state === 'running' && attempt.id !== liveAttemptId,
    ),
  );
  return deliveryPending || needsRecovery ? 2_000 : false;
}
