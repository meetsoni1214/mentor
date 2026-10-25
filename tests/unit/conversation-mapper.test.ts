import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  toCompletedTurn,
  toConversationTurn,
  toRunAttempt,
} from '../../packages/backend/src/conversation/adapters/conversation.mapper.js';
import type { RunAttemptRow } from '../../packages/backend/src/conversation/adapters/conversation.mapper.js';
import type { RunAttempt } from '../../packages/backend/src/conversation/domain/conversation.js';

const startedAt = new Date('2026-10-25T12:00:00Z');
const finishedAt = new Date('2026-10-25T12:00:30Z');

function runningRow(): RunAttemptRow {
  return {
    id: 'attempt-1',
    conversationId: 'internal-conversation-id',
    turnId: 'turn-1',
    requestId: 'request-1',
    model: 'fake-model',
    attemptNumber: 1,
    state: 'running',
    startedAt,
    deadlineAt: new Date('2026-10-25T12:01:00Z'),
    finishedAt: null,
    answer: null,
    errorCode: null,
    sources: [],
    activity: [],
    inputTokens: null,
    outputTokens: null,
    contextLimited: false,
  };
}

describe('conversation persistence mapping', () => {
  it('returns a turn without persistence-only or newly added internal columns', () => {
    expect(
      toConversationTurn({
        id: 'turn-1',
        conversationId: 'internal-conversation-id',
        requestId: 'request-1',
        sequence: 1,
        text: 'Saved question',
        createdAt: startedAt,
        ...{ internalDiagnostic: 'private' },
      }),
    ).toEqual({
      id: 'turn-1',
      requestId: 'request-1',
      sequence: 1,
      text: 'Saved question',
      createdAt: startedAt,
    });
  });

  it.each<Partial<RunAttemptRow>>([
    { state: 'running' },
    { state: 'completed', finishedAt, answer: 'Saved answer' },
    { state: 'failed', finishedAt, errorCode: 'PROVIDER_ERROR' },
    { state: 'interrupted', finishedAt, errorCode: 'INTERRUPTED' },
  ])(
    'maps the $state state without exposing the stored conversation link',
    (outcome) => {
      const row = {
        ...runningRow(),
        ...outcome,
        internalDiagnostic: 'private',
      };
      const mapped = toRunAttempt(row);
      expect(mapped).toMatchObject({
        id: row.id,
        turnId: row.turnId,
        requestId: row.requestId,
        state: row.state,
        finishedAt: row.finishedAt,
        answer: row.answer,
        errorCode: row.errorCode,
      });
      expect(mapped).not.toHaveProperty('conversationId');
      expect(mapped).not.toHaveProperty('internalDiagnostic');
    },
  );

  it('preserves zero, unknown usage, and normalized answer metadata', () => {
    const row: RunAttemptRow = {
      ...runningRow(),
      state: 'completed',
      finishedAt,
      answer: 'Saved answer',
      inputTokens: 0,
      outputTokens: null,
      contextLimited: true,
      sources: [{ title: 'Source', url: 'https://example.test' }],
      activity: [{ type: 'web_search', status: 'completed' }],
    };
    expect(toRunAttempt(row)).toMatchObject({
      inputTokens: 0,
      outputTokens: null,
      contextLimited: true,
      sources: row.sources,
      activity: row.activity,
    });
  });

  it.each<Partial<RunAttemptRow>>([
    { state: 'running', finishedAt },
    { state: 'running', answer: 'Private partial answer' },
    { state: 'running', errorCode: 'PROVIDER_ERROR' },
    { state: 'completed', answer: 'Saved answer' },
    { state: 'completed', finishedAt },
    {
      state: 'completed',
      finishedAt,
      answer: 'Saved answer',
      errorCode: 'PROVIDER_ERROR',
    },
    { state: 'failed', errorCode: 'PROVIDER_ERROR' },
    {
      state: 'failed',
      finishedAt,
      answer: 'Private partial answer',
      errorCode: 'PROVIDER_ERROR',
    },
    { state: 'failed', finishedAt },
    { state: 'failed', finishedAt, errorCode: 'INTERRUPTED' },
    {
      state: 'failed',
      finishedAt,
      errorCode: 'Private provider error payload',
    },
    { state: 'interrupted', errorCode: 'INTERRUPTED' },
    { state: 'interrupted', finishedAt, errorCode: 'PROVIDER_ERROR' },
    {
      state: 'interrupted',
      finishedAt,
      answer: 'Private partial answer',
      errorCode: 'INTERRUPTED',
    },
    { state: 'Private unknown state' },
  ])(
    'rejects an inconsistent stored attempt with a fixed error: %j',
    (outcome) => {
      expect(() => toRunAttempt({ ...runningRow(), ...outcome })).toThrow(
        new Error('Invalid stored conversation record'),
      );
    },
  );

  it.each(['PROVIDER_ERROR', 'REFUSED', 'INCOMPLETE', 'INVALID_RESPONSE'])(
    'preserves the known failure code %s',
    (errorCode) => {
      expect(
        toRunAttempt({
          ...runningRow(),
          state: 'failed',
          finishedAt,
          errorCode,
        }),
      ).toMatchObject({ state: 'failed', errorCode });
    },
  );

  it('maps selected context fields and rejects a completed pair with no answer', () => {
    expect(
      toCompletedTurn({
        text: 'Question',
        answer: 'Answer',
        ...{ internalDiagnostic: 'private' },
      }),
    ).toEqual({ text: 'Question', answer: 'Answer' });
    expect(() =>
      toCompletedTurn({ text: 'Private question', answer: null }),
    ).toThrow(new Error('Invalid stored conversation record'));
  });

  it('narrows required and forbidden fields by run state at compile time', () => {
    expectTypeOf<
      Extract<RunAttempt, { state: 'running' }>['finishedAt']
    >().toEqualTypeOf<null>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'running' }>['answer']
    >().toEqualTypeOf<null>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'running' }>['errorCode']
    >().toEqualTypeOf<null>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'completed' }>['finishedAt']
    >().toEqualTypeOf<Date>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'completed' }>['answer']
    >().toEqualTypeOf<string>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'completed' }>['errorCode']
    >().toEqualTypeOf<null>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'failed' }>['finishedAt']
    >().toEqualTypeOf<Date>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'failed' }>['answer']
    >().toEqualTypeOf<null>();
    expectTypeOf<
      Extract<RunAttempt, { state: 'interrupted' }>['errorCode']
    >().toEqualTypeOf<'INTERRUPTED'>();
  });
});
