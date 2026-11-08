import type { components } from '@mentor/api-client';
import { z } from 'zod';
import { resultSchema, versionSchema } from './conversation-contracts';

const identitySchema = versionSchema.extend({
  turnId: z.uuid(),
  attemptId: z.uuid(),
});
export const streamEventSchema = z.union([
  resultSchema.safeExtend({
    type: z.literal('accepted'),
    replayed: z.boolean(),
  }),
  identitySchema.extend({ type: z.literal('text_delta'), delta: z.string() }),
  resultSchema.safeExtend({ type: z.literal('result') }),
  identitySchema.extend({
    type: z.literal('error'),
    code: z.enum(['STALE_HISTORY', 'INTERNAL_ERROR']),
    // Provider/server text is validated but never displayed as an error message.
    message: z.string(),
  }),
]) satisfies z.ZodType<
  | components['schemas']['ConversationAcceptedEventDto']
  | components['schemas']['ConversationTextDeltaEventDto']
  | components['schemas']['ConversationResultEventDto']
  | components['schemas']['ConversationStreamErrorEventDto']
>;
export type ConversationStreamEvent = z.infer<typeof streamEventSchema>;
export type ConversationStreamProgress = Exclude<
  ConversationStreamEvent,
  { type: 'result' | 'error' }
>;

export interface ProvisionalResponse {
  historyVersion: number;
  turnId: string;
  attemptId: string;
  text: string;
}
