import type { ConversationHistory } from './conversation-contracts';

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
) {
  return deliveryPending || hasRunningAttempt(history) ? 2_000 : false;
}
