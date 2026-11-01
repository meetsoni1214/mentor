import { ConversationError } from '@mentor/backend/conversation';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';

// Decode HTTP decimal strings here; numeric ranges belong to the use case.
const decimalQuery = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(Number);
const historyQuery = z
  .strictObject({
    limit: decimalQuery.optional(),
    historyVersion: decimalQuery.optional(),
    beforeSequence: decimalQuery.optional(),
  })
  .transform(({ limit, historyVersion, beforeSequence }) => ({
    ...(limit === undefined ? {} : { limit }),
    ...(historyVersion === undefined && beforeSequence === undefined
      ? {}
      : { cursor: { historyVersion, beforeSequence } }),
  }));

export function parseHistoryQuery(value: unknown) {
  const result = historyQuery.safeParse(value);
  if (!result.success) throw new ConversationError('INVALID_INPUT');
  return result.data;
}

export function requireJson(request: IncomingMessage): void {
  if (
    request.headers['content-type']?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new UnsupportedMediaTypeException();
}
