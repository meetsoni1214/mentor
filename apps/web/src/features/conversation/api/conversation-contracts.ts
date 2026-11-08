import type { paths } from '@mentor/api-client';
import { z } from 'zod';

const nonnegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const positiveInteger = nonnegativeInteger.positive();
export const versionSchema = z.object({ historyVersion: nonnegativeInteger });
export const cursorSchema = versionSchema.extend({
  beforeSequence: positiveInteger,
});
export const sourceSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    url: z
      .url()
      .max(2048)
      .refine((value) => {
        if (
          /\s/.test(value) ||
          value.includes('\\') ||
          [...value].some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
          )
        )
          return false;
        try {
          const url = new URL(value);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }),
    startIndex: nonnegativeInteger.optional(),
    endIndex: positiveInteger.optional(),
  })
  .refine((source) =>
    source.startIndex === undefined
      ? source.endIndex === undefined
      : source.endIndex !== undefined && source.endIndex > source.startIndex,
  )
  .transform(({ title, url, startIndex, endIndex }) => ({
    title,
    url,
    ...(startIndex === undefined || endIndex === undefined
      ? {}
      : { startIndex, endIndex }),
  }));

function splitsUnicodeCharacter(text: string, offset: number): boolean {
  // A boundary on the second UTF-16 unit would split a character such as an emoji.
  const characterCode = text.charCodeAt(offset);
  return characterCode >= 0xdc00 && characterCode <= 0xdfff;
}

const attemptSchema = z
  .object({
    id: z.uuid(),
    turnId: z.uuid(),
    requestId: z.uuid(),
    attemptNumber: positiveInteger,
    model: z.string().min(1),
    state: z.enum(['running', 'completed', 'failed', 'interrupted']),
    startedAt: z.iso.datetime(),
    deadlineAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    answer: z.string().nullable(),
    errorCode: z
      .enum([
        'PROVIDER_ERROR',
        'REFUSED',
        'INCOMPLETE',
        'INVALID_RESPONSE',
        'RATE_LIMITED',
        'LIMIT_EXCEEDED',
        'INTERRUPTED',
      ])
      .nullable(),
    sources: z.array(sourceSchema).max(20),
    activity: z
      .array(
        z.object({
          type: z.literal('web_search'),
          status: z.enum(['completed', 'failed']),
        }),
      )
      .max(20),
    inputTokens: nonnegativeInteger.nullable(),
    outputTokens: nonnegativeInteger.nullable(),
    contextLimited: z.boolean(),
  })
  .refine((attempt) => {
    const citationRanges = attempt.sources.flatMap(
      ({ startIndex, endIndex }) => {
        if (startIndex === undefined || endIndex === undefined) return [];
        return [{ startIndex, endIndex }];
      },
    );
    if (citationRanges.length === 0) return true;

    const { state, answer } = attempt;
    if (state !== 'completed' || answer === null) return false;

    citationRanges.sort((a, b) => a.startIndex - b.startIndex);
    for (const [index, citation] of citationRanges.entries()) {
      const { startIndex, endIndex } = citation;
      if (endIndex > answer.length) return false;

      const startsInsideCharacter = splitsUnicodeCharacter(answer, startIndex);
      const endsInsideCharacter = splitsUnicodeCharacter(answer, endIndex);
      if (startsInsideCharacter || endsInsideCharacter) return false;

      const previous = citationRanges[index - 1];
      if (!previous) continue;

      const followsPrevious = startIndex >= previous.endIndex;
      const sharesSameSpan =
        startIndex === previous.startIndex && endIndex === previous.endIndex;
      if (!followsPrevious && !sharesSameSpan) return false;
    }
    return true;
  })
  .refine((attempt) => {
    switch (attempt.state) {
      case 'running':
        return (
          attempt.finishedAt === null &&
          attempt.answer === null &&
          attempt.errorCode === null
        );
      case 'completed':
        return (
          attempt.finishedAt !== null &&
          attempt.answer !== null &&
          attempt.errorCode === null
        );
      case 'failed':
        return (
          attempt.finishedAt !== null &&
          attempt.answer === null &&
          attempt.errorCode !== null &&
          attempt.errorCode !== 'INTERRUPTED'
        );
      case 'interrupted':
        return (
          attempt.finishedAt !== null &&
          attempt.answer === null &&
          attempt.errorCode === 'INTERRUPTED'
        );
    }
  });
const turnSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  sequence: positiveInteger,
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export const historySchema = versionSchema
  .extend({
    turns: z
      .array(turnSchema.extend({ attempts: z.array(attemptSchema) }))
      .max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .refine(
    (history) =>
      (history.nextCursor === null ||
        history.nextCursor.historyVersion === history.historyVersion) &&
      history.turns.every((turn) =>
        turn.attempts.every((attempt) => attempt.turnId === turn.id),
      ),
  );
export const resultSchema = versionSchema
  .extend({
    turn: turnSchema,
    attempt: attemptSchema,
  })
  .refine((result) => result.attempt.turnId === result.turn.id);
export const statusSchema = z
  .object({
    enabled: z.boolean(),
    limits: z
      .object({
        model: z.string().min(1),
        maxMessageBytes: positiveInteger,
        maxContextBytes: positiveInteger,
        maxOutputTokens: positiveInteger,
        deadlineMs: positiveInteger,
      })
      .nullable(),
  })
  .refine((status) => status.enabled === (status.limits !== null));
export const errorSchema = z.object({
  statusCode: positiveInteger,
  code: z.enum([
    'EXECUTION_UNAVAILABLE',
    'NOT_FOUND',
    'INVALID_INPUT',
    'STALE_HISTORY',
    'IDEMPOTENCY_CONFLICT',
    'BUSY',
    'NOT_RETRYABLE',
  ]),
  message: z.string(),
});

export type ConversationHistory = z.infer<typeof historySchema>;
export type TurnResult = z.infer<typeof resultSchema>;
export type HistoryCursor = z.infer<typeof cursorSchema>;
export type SubmitInput =
  paths['/api/v1/conversation/turns']['post']['requestBody']['content']['application/json'];
export type RetryInput =
  paths['/api/v1/conversation/turns/{turnId}/retry']['post']['requestBody']['content']['application/json'];
export type ClearInput =
  paths['/api/v1/conversation/history']['delete']['requestBody']['content']['application/json'];

export interface HistoryOptions {
  cursor?: HistoryCursor;
  limit?: number;
}
