import {
  apiClient,
  csrfToken,
  mutationHeaders,
} from '../../../lib/api-request';
import type {
  RetryInput,
  SubmitInput,
  TurnResult,
} from './conversation-contracts';
import {
  ConversationApiError,
  conversationFailure,
} from './conversation-errors';
import { streamEventSchema } from './conversation-stream-contracts';
import type { ConversationStreamProgress } from './conversation-stream-contracts';
import { readEventStream } from './conversation-stream-reader';

export async function streamConversationTurn(
  input: SubmitInput,
  onProgress: (event: ConversationStreamProgress) => void,
  signal: AbortSignal,
): Promise<TurnResult> {
  const token = await csrfToken(signal);
  signal.throwIfAborted();
  const { data, error, response } = await apiClient.POST(
    '/api/v1/conversation/turns/stream',
    {
      body: input,
      params: { header: mutationHeaders(token) },
      signal,
      cache: 'no-store',
      parseAs: 'stream',
    },
  );
  if (!response.ok) throw conversationFailure(response, error);
  return readConversationStream(
    data,
    response,
    input.historyVersion,
    (result) =>
      result.turn.requestId === input.requestId &&
      result.turn.text === input.text &&
      result.attempt.requestId === input.requestId,
    onProgress,
    signal,
  );
}

export async function streamRetryConversationTurn(
  turnId: string,
  input: RetryInput,
  onProgress: (event: ConversationStreamProgress) => void,
  signal: AbortSignal,
): Promise<TurnResult> {
  const token = await csrfToken(signal);
  signal.throwIfAborted();
  const { data, error, response } = await apiClient.POST(
    '/api/v1/conversation/turns/{turnId}/retry/stream',
    {
      body: input,
      params: { path: { turnId }, header: mutationHeaders(token) },
      signal,
      cache: 'no-store',
      parseAs: 'stream',
    },
  );
  if (!response.ok) throw conversationFailure(response, error);
  return readConversationStream(
    data,
    response,
    input.historyVersion,
    (result) =>
      result.turn.id === turnId &&
      result.attempt.requestId === input.requestId &&
      result.attempt.attemptNumber > 1,
    onProgress,
    signal,
  );
}

async function readConversationStream(
  data: ReadableStream<Uint8Array> | null | undefined,
  response: Response,
  historyVersion: number,
  matchesOperation: (result: TurnResult) => boolean,
  onProgress: (event: ConversationStreamProgress) => void,
  signal: AbortSignal,
): Promise<TurnResult> {
  if (
    response.headers.get('Content-Type')?.split(';')[0]?.trim() !==
      'text/event-stream' ||
    !data
  )
    throw new Error('Invalid streaming response.');

  let accepted:
    Extract<ConversationStreamProgress, { type: 'accepted' }> | undefined;
  let result: TurnResult | undefined;
  await readEventStream(data, signal, (name, json) => {
    signal.throwIfAborted();
    const event = streamEventSchema.parse(JSON.parse(json));
    if (name !== event.type) throw new Error('Invalid stream event name.');
    if (event.type === 'accepted') {
      if (
        accepted ||
        event.historyVersion !== historyVersion ||
        !matchesOperation(event)
      )
        throw new Error('Invalid stream admission.');
      accepted = event;
      onProgress(event);
      return false;
    }
    if (
      !accepted ||
      event.historyVersion !== accepted.historyVersion ||
      (event.type === 'result'
        ? event.turn.id !== accepted.turn.id ||
          event.attempt.id !== accepted.attempt.id ||
          event.turn.requestId !== accepted.turn.requestId ||
          event.turn.text !== accepted.turn.text ||
          event.attempt.requestId !== accepted.attempt.requestId ||
          event.attempt.attemptNumber !== accepted.attempt.attemptNumber ||
          !matchesOperation(event)
        : event.turnId !== accepted.turn.id ||
          event.attemptId !== accepted.attempt.id)
    )
      throw new Error('Invalid stream identity.');
    if (event.type === 'error') {
      if (event.code === 'STALE_HISTORY')
        throw new ConversationApiError(409, 'STALE_HISTORY');
      throw new Error('Stream result could not be confirmed.');
    }
    if (event.type === 'text_delta') {
      if (accepted.replayed || accepted.attempt.state !== 'running')
        throw new Error('Unexpected stream text.');
      onProgress(event);
      return false;
    }
    if (!accepted.replayed && event.attempt.state === 'running')
      throw new Error('Stream result is still running.');
    result = event;
    return true;
  });
  if (!result) throw new Error('Stream result is missing.');
  return result;
}
