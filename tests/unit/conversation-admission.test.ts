import { describe, expect, it } from 'vitest';
import {
  assertHistoryVersion,
  assertNoRunningAttempt,
  decideSubmission,
  replayRetry,
} from '../../packages/backend/src/conversation/domain/admission-policy.js';
import type {
  ConversationTurn,
  RunAttempt,
  RunState,
} from '../../packages/backend/src/conversation/domain/conversation.js';

const turn: ConversationTurn = {
  id: 'turn-1',
  requestId: 'submission-1',
  sequence: 1,
  text: 'A saved question',
  createdAt: new Date('2026-10-25T12:00:00Z'),
};

function retryAttempt(state: RunState = 'running'): RunAttempt {
  const details = {
    id: 'attempt-2',
    turnId: turn.id,
    requestId: 'retry-1',
    attemptNumber: 2,
    model: 'fake-model',
    startedAt: turn.createdAt,
    deadlineAt: new Date('2026-10-25T12:01:00Z'),
    sources: [],
    activity: [],
    inputTokens: null,
    outputTokens: null,
    contextLimited: false,
  };
  const finishedAt = new Date('2026-10-25T12:00:30Z');
  switch (state) {
    case 'running':
      return {
        ...details,
        state,
        finishedAt: null,
        answer: null,
        errorCode: null,
      };
    case 'completed':
      return {
        ...details,
        state,
        finishedAt,
        answer: 'A saved answer',
        errorCode: null,
      };
    case 'failed':
      return {
        ...details,
        state,
        finishedAt,
        answer: null,
        errorCode: 'PROVIDER_ERROR',
      };
    case 'interrupted':
      return {
        ...details,
        state,
        finishedAt,
        answer: null,
        errorCode: 'INTERRUPTED',
      };
  }
}

describe('conversation admission policy', () => {
  it('accepts the current history version, including after clearing', () => {
    expect(() => assertHistoryVersion(0, 0)).not.toThrow();
    expect(() => assertHistoryVersion(2, 2)).not.toThrow();
  });

  it.each([
    [1, 0],
    [0, 1],
    [2, 1],
  ])(
    'rejects a history version mismatch: actual %i, expected %i',
    (actual, expected) => {
      expect(() => assertHistoryVersion(actual, expected)).toThrow(
        'STALE_HISTORY',
      );
    },
  );

  it('admits a new submission when its key is unused and no attempt is running', () => {
    expect(
      decideSubmission('A new question', {
        existingTurn: null,
        requestIdInUse: false,
        hasRunningAttempt: false,
      }),
    ).toEqual({ kind: 'start' });
  });

  it('replays an accepted submission even while an attempt is running', () => {
    expect(
      decideSubmission(turn.text, {
        existingTurn: turn,
        requestIdInUse: true,
        hasRunningAttempt: true,
      }),
    ).toEqual({ kind: 'replay', turn });
  });

  it.each(['Another question', `${turn.text} `, turn.text.toLowerCase()])(
    'rejects changed text rather than replaying or reporting busy: %s',
    (text) => {
      expect(() =>
        decideSubmission(text, {
          existingTurn: turn,
          requestIdInUse: true,
          hasRunningAttempt: true,
        }),
      ).toThrow('IDEMPOTENCY_CONFLICT');
    },
  );

  it('rejects a retry key used for a new submission before checking busy state', () => {
    expect(() =>
      decideSubmission('A new question', {
        existingTurn: null,
        requestIdInUse: true,
        hasRunningAttempt: true,
      }),
    ).toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('rejects a distinct submission while an attempt is running', () => {
    expect(() =>
      decideSubmission('A new question', {
        existingTurn: null,
        requestIdInUse: false,
        hasRunningAttempt: true,
      }),
    ).toThrow('BUSY');
  });

  it('permits starting work only without a running attempt', () => {
    expect(() => assertNoRunningAttempt(false)).not.toThrow();
    expect(() => assertNoRunningAttempt(true)).toThrow('BUSY');
  });

  it('leaves a fresh retry key for latest-turn eligibility checks', () => {
    expect(replayRetry(turn.id, null)).toBeNull();
  });

  it.each<RunState>(['running', 'completed', 'failed', 'interrupted'])(
    'returns the exact accepted retry when it is %s without rechecking latest-turn eligibility',
    (state) => {
      const existing = retryAttempt(state);
      expect(replayRetry(turn.id, existing)).toBe(existing);
    },
  );

  it('rejects an initial submission key used as a retry key', () => {
    expect(() =>
      replayRetry(turn.id, {
        ...retryAttempt(),
        attemptNumber: 1,
      }),
    ).toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('rejects a retry key already accepted for another turn', () => {
    expect(() => replayRetry('another-turn', retryAttempt())).toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
  });
});
