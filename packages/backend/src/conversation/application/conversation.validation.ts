import { z } from 'zod';
import { ConversationError } from '../domain/conversation.js';

// Identifiers retain the application's UUID shape without a version restriction.
export const ownerIdSchema = z.guid();
export const turnIdSchema = z.guid();
const historyVersion = z.int().nonnegative();

export const submitTurnSchema = z.strictObject({
  historyVersion,
  requestId: z.guid(),
  text: z.string(),
});

export const retryTurnSchema = z.strictObject({
  historyVersion,
  requestId: z.guid(),
});

export const clearHistorySchema = z.strictObject({ historyVersion });

export const historyOptionsSchema = z
  .strictObject({
    limit: z.int().min(1).max(100).optional(),
    cursor: z
      .strictObject({
        historyVersion,
        beforeSequence: z.int().positive(),
      })
      .optional(),
  })
  .transform(({ limit, cursor }) => ({
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  }));

export function parseConversationInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConversationError('INVALID_INPUT');
  return result.data;
}
