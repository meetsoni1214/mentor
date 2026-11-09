import type { components } from '@mentor/api-client';
import { z } from 'zod';
import {
  apiClient,
  csrfToken,
  mutationHeaders,
  requestFailure,
} from '../../../lib/api-request';
import { memoryEntrySchema, memorySnapshotSchema } from './memory-contracts';
import type { SaveMemoryInput } from './memory-contracts';

type MemoryErrorCode = components['schemas']['MemoryErrorDto']['code'];
const messages: Record<MemoryErrorCode, string> = {
  INVALID_INPUT: 'This memory request is invalid. Your draft is kept.',
  NOT_FOUND: 'No saved memory was found for this request.',
  IDEMPOTENCY_CONFLICT:
    'This request ID belongs to different wording. Check the original save before continuing.',
  BUSY: 'The assistant is working. Wait for it to finish before saving memory. Your draft is kept.',
  LIMIT_EXCEEDED: 'Your memory profile is full. Your draft is kept.',
};
const errorSchema = z.object({
  statusCode: z.number(),
  code: z.custom<MemoryErrorCode>(
    (value) => typeof value === 'string' && Object.hasOwn(messages, value),
  ),
});
export class MemoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: MemoryErrorCode,
  ) {
    super(messages[code]);
  }
}
function failure(response: Response, error: unknown) {
  if (response.status === 401 || response.status === 403)
    return requestFailure(response);
  const parsed = errorSchema.safeParse(error);
  return parsed.success && parsed.data.statusCode === response.status
    ? new MemoryApiError(response.status, parsed.data.code)
    : requestFailure(response);
}
export async function listMemories(signal: AbortSignal) {
  const { data, error, response } = await apiClient.GET('/api/v1/memory', {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw failure(response, error);
  return memorySnapshotSchema.parse(data);
}
export async function getMemory(entryId: string, signal: AbortSignal) {
  const { data, error, response } = await apiClient.GET(
    '/api/v1/memory/{entryId}',
    { params: { path: { entryId } }, signal, cache: 'no-store' },
  );
  if (!response.ok) throw failure(response, error);
  const entry = memoryEntrySchema.parse(data);
  if (entry.id !== entryId) throw new Error('Invalid memory detail response.');
  return entry;
}
export async function findSavedMemory(requestId: string, signal: AbortSignal) {
  const { data, error, response } = await apiClient.GET(
    '/api/v1/memory/requests/{requestId}',
    { params: { path: { requestId } }, signal, cache: 'no-store' },
  );
  if (!response.ok) throw failure(response, error);
  const entry = memoryEntrySchema.parse(data);
  if (entry.requestId !== requestId)
    throw new Error('Invalid saved-request response.');
  return entry;
}
export async function saveMemory(input: SaveMemoryInput, signal: AbortSignal) {
  const token = await csrfToken(signal);
  signal.throwIfAborted();
  const { data, error, response } = await apiClient.POST('/api/v1/memory', {
    body: input,
    params: { header: mutationHeaders(token) },
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw failure(response, error);
  const entry = memoryEntrySchema.parse(data);
  if (
    entry.requestId !== input.requestId ||
    entry.sourceRequest !== input.sourceRequest
  )
    throw new Error('Invalid memory save response.');
  return entry;
}
