import type {
  ConversationLoop,
  RetryRequest,
  Submission,
} from '@mentor/backend/conversation';

// Repository fixtures include ownership; the use case accepts the trusted owner
// separately from the command so callers cannot override it through input fields.
export function submitTurn(
  loop: Pick<ConversationLoop, 'submit'>,
  input: Submission,
) {
  const { ownerId, ...command } = input;
  return loop.submit(ownerId, command);
}

export function retryTurn(
  loop: Pick<ConversationLoop, 'retry'>,
  input: RetryRequest,
) {
  const { ownerId, turnId, ...command } = input;
  return loop.retry(ownerId, turnId, command);
}
