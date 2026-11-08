import { ObsoleteSessionError } from '../src/features/auth/session-scope.js';
import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { SessionState } from '../src/features/auth/session-state.js';
import {
  ConversationScope,
  ObsoleteHistoryError,
} from '../src/features/conversation/state/conversation-scope.js';

const clients: QueryClient[] = [];
function setup() {
  const queries = new QueryClient();
  clients.push(queries);
  const session = new SessionState(queries);
  return { session, scope: new ConversationScope(session.scope()) };
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('conversation request scope without HTTP or query operations', () => {
  it('accepts a newer version and rejects older pending work even when cancellation is ignored', async () => {
    const { scope } = setup();
    const pending = deferred<{ historyVersion: number }>();
    const old = scope
      .run(() => pending.promise, 0)
      .catch((error: unknown) => error);
    const current = await scope.run(async () => ({ historyVersion: 1 }), 0);
    expect(current.value).toEqual({ historyVersion: 1 });
    expect(current.historyChanged).toBe(true);
    pending.resolve({ historyVersion: 0 });
    expect(await old).toBeInstanceOf(ObsoleteHistoryError);
    expect(() => scope.assertCurrent(0)).toThrow(ObsoleteHistoryError);
    expect(() => scope.assertCurrent(1)).not.toThrow();
  });

  it('rejects a lower version without making it current', async () => {
    const { scope } = setup();
    await scope.run(async () => ({ historyVersion: 2 }));
    await expect(
      scope.run(async () => ({ historyVersion: 1 })),
    ).rejects.toBeInstanceOf(ObsoleteHistoryError);
    expect(() => scope.assertCurrent(2)).not.toThrow();
  });

  it('rejects completion after session replacement', async () => {
    const { session, scope } = setup();
    const pending = deferred<{ historyVersion: number }>();
    const work = scope
      .run(() => pending.promise)
      .catch((error: unknown) => error);
    session.replace(null);
    pending.resolve({ historyVersion: 0 });
    expect(await work).toBeInstanceOf(ObsoleteSessionError);
  });
});
