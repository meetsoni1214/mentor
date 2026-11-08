import {
  apiClient,
  csrfToken,
  mutationHeaders,
} from '../../../lib/api-request';
import {
  historySchema,
  resultSchema,
  statusSchema,
  versionSchema,
} from './conversation-contracts';
import type {
  ClearInput,
  HistoryOptions,
  RetryInput,
  SubmitInput,
} from './conversation-contracts';
import { conversationFailure } from './conversation-errors';

export async function getAssistantStatus(signal: AbortSignal) {
  const { data, error, response } = await apiClient.GET(
    '/api/v1/assistant/status',
    {
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw conversationFailure(response, error);
  return statusSchema.parse(data);
}

export async function getConversationHistory(
  options: HistoryOptions,
  signal: AbortSignal,
) {
  const { data, error, response } = await apiClient.GET(
    '/api/v1/conversation',
    {
      params: {
        query: {
          ...options.cursor,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        },
      },
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw conversationFailure(response, error);
  const history = historySchema.parse(data);
  if (
    options.cursor &&
    history.historyVersion !== options.cursor.historyVersion
  ) {
    throw new Error('Invalid history cursor response.');
  }
  return history;
}

export async function submitConversationTurn(
  input: SubmitInput,
  signal: AbortSignal,
) {
  const token = await csrfToken(signal);
  signal.throwIfAborted();
  const { data, error, response } = await apiClient.POST(
    '/api/v1/conversation/turns',
    {
      body: input,
      params: { header: mutationHeaders(token) },
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw conversationFailure(response, error);
  const result = resultSchema.parse(data);
  if (
    result.historyVersion !== input.historyVersion ||
    result.turn.requestId !== input.requestId ||
    result.turn.text !== input.text
  ) {
    throw new Error('Invalid submission response.');
  }
  return result;
}

export async function retryConversationTurn(
  turnId: string,
  input: RetryInput,
  signal: AbortSignal,
) {
  const token = await csrfToken(signal);
  signal.throwIfAborted();
  const { data, error, response } = await apiClient.POST(
    '/api/v1/conversation/turns/{turnId}/retry',
    {
      body: input,
      params: { path: { turnId }, header: mutationHeaders(token) },
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw conversationFailure(response, error);
  const result = resultSchema.parse(data);
  if (
    result.historyVersion !== input.historyVersion ||
    result.turn.id !== turnId ||
    result.attempt.requestId !== input.requestId
  ) {
    throw new Error('Invalid retry response.');
  }
  return result;
}

export async function clearConversationHistory(
  input: ClearInput,
  signal: AbortSignal,
) {
  const token = await csrfToken(signal);
  signal.throwIfAborted();
  const { data, error, response } = await apiClient.DELETE(
    '/api/v1/conversation/history',
    {
      body: input,
      params: { header: mutationHeaders(token) },
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw conversationFailure(response, error);
  const result = versionSchema.parse(data);
  if (result.historyVersion <= input.historyVersion)
    throw new Error('Invalid clear-history response.');
  return result;
}
