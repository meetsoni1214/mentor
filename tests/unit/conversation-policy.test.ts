import { describe, expect, it } from 'vitest';
import {
  assertRetryable,
  canFinish,
} from '../../packages/backend/src/conversation/domain/conversation.js';
import type { RunState } from '../../packages/backend/src/conversation/domain/conversation.js';

describe('conversation run policy', () => {
  const deadline = new Date('2026-10-25T12:00:00Z');

  it('accepts a running result only before the deadline', () => {
    expect(
      canFinish('running', deadline, new Date(deadline.getTime() - 1)),
    ).toBe(true);
    expect(canFinish('running', deadline, deadline)).toBe(false);
    expect(
      canFinish('running', deadline, new Date(deadline.getTime() + 1)),
    ).toBe(false);
  });

  it.each<RunState>(['completed', 'failed', 'interrupted'])(
    'never replaces an already %s result',
    (state) => expect(canFinish(state, deadline, new Date(0))).toBe(false),
  );

  it.each<RunState>(['failed', 'interrupted'])(
    'allows an explicit retry of the latest %s turn',
    (state) =>
      expect(() => assertRetryable('latest', 'latest', state)).not.toThrow(),
  );

  it.each<RunState>(['running', 'completed'])(
    'rejects retrying a %s turn',
    (state) =>
      expect(() => assertRetryable('latest', 'latest', state)).toThrow(
        'NOT_RETRYABLE',
      ),
  );

  it('rejects a retry that would insert a response before newer messages', () => {
    expect(() => assertRetryable('old', 'latest', 'failed')).toThrow(
      'NOT_RETRYABLE',
    );
  });
});
