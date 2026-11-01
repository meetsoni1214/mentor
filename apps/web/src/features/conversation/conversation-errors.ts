import { requestFailure } from '../../lib/api-request';
import { errorSchema } from './conversation-contracts';

const errorMessages = {
  EXECUTION_UNAVAILABLE:
    'Assistant execution is unavailable. Your message can be kept until it is ready.',
  NOT_FOUND: 'This turn is no longer available.',
  INVALID_INPUT: 'This conversation request is invalid.',
  STALE_HISTORY: 'History changed. Reload the conversation before continuing.',
  IDEMPOTENCY_CONFLICT: 'This request key already belongs to different input.',
  BUSY: 'The assistant is already working. Wait for it to finish.',
  NOT_RETRYABLE: 'Only the latest failed or interrupted turn can be retried.',
};

export class ConversationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: keyof typeof errorMessages,
  ) {
    super(errorMessages[code]);
  }
}

export function conversationFailure(response: Response, error: unknown): Error {
  // Authentication/CSRF errors must retain their meaning even with a bad body.
  if (response.status === 401 || response.status === 403)
    return requestFailure(response);
  const parsed = errorSchema.safeParse(error);
  if (parsed.success && parsed.data.statusCode === response.status) {
    return new ConversationApiError(response.status, parsed.data.code);
  }
  return requestFailure(response);
}
