import type { CompletedTurn } from '../application/conversation.contracts.js';
import type { ConversationTurn, RunAttempt } from '../domain/conversation.js';
import type {
  conversationAttempts,
  conversationTurns,
} from './conversation.schema.js';

type TurnRow = typeof conversationTurns.$inferSelect;

// SQL constraints protect stored structure, but typed columns cannot prove
// that a row's state and nullable fields form a valid application model.
export type RunAttemptRow = Omit<
  typeof conversationAttempts.$inferSelect,
  'state' | 'errorCode'
> & { state: string; errorCode: string | null };

function invalidRecord(): never {
  // Do not include persisted content or provider metadata in this error.
  throw new Error('Invalid stored conversation record');
}

export function toConversationTurn(row: TurnRow): ConversationTurn {
  return {
    id: row.id,
    requestId: row.requestId,
    sequence: row.sequence,
    text: row.text,
    createdAt: row.createdAt,
  };
}

export function toRunAttempt(row: RunAttemptRow): RunAttempt {
  const details = {
    id: row.id,
    turnId: row.turnId,
    requestId: row.requestId,
    attemptNumber: row.attemptNumber,
    model: row.model,
    startedAt: row.startedAt,
    deadlineAt: row.deadlineAt,
    sources: row.sources,
    activity: row.activity,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    contextLimited: row.contextLimited,
  };
  switch (row.state) {
    case 'running':
      if (
        row.finishedAt !== null ||
        row.answer !== null ||
        row.errorCode !== null
      )
        return invalidRecord();
      return {
        ...details,
        state: 'running',
        finishedAt: null,
        answer: null,
        errorCode: null,
      };
    case 'completed':
      if (
        row.finishedAt === null ||
        row.answer === null ||
        row.errorCode !== null
      )
        return invalidRecord();
      return {
        ...details,
        state: 'completed',
        finishedAt: row.finishedAt,
        answer: row.answer,
        errorCode: null,
      };
    case 'failed':
      if (row.finishedAt === null || row.answer !== null)
        return invalidRecord();
      switch (row.errorCode) {
        case 'PROVIDER_ERROR':
        case 'REFUSED':
        case 'INCOMPLETE':
        case 'INVALID_RESPONSE':
        case 'RATE_LIMITED':
        case 'LIMIT_EXCEEDED':
          return {
            ...details,
            state: 'failed',
            finishedAt: row.finishedAt,
            answer: null,
            errorCode: row.errorCode,
          };
        default:
          return invalidRecord();
      }
    case 'interrupted':
      if (
        row.finishedAt === null ||
        row.answer !== null ||
        row.errorCode !== 'INTERRUPTED'
      )
        return invalidRecord();
      return {
        ...details,
        state: 'interrupted',
        finishedAt: row.finishedAt,
        answer: null,
        errorCode: 'INTERRUPTED',
      };
    default:
      return invalidRecord();
  }
}

export function toCompletedTurn(row: {
  text: string;
  answer: string | null;
}): CompletedTurn {
  if (row.answer === null) return invalidRecord();
  return { text: row.text, answer: row.answer };
}
