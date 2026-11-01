import type { QueryClient } from '@tanstack/react-query';
import { RequestError } from '../../lib/api-request';
import { getSession, signIn, signOut } from './auth-api';
import type { Session } from './auth-api';
import { ObsoleteSessionError } from './session-scope';
import type { SessionScope } from './session-scope';

export const sessionKey = ['session'] as const;

// One instance per QueryClient, never a module-global owner/session cache.
export class SessionState {
  private generation = new AbortController();
  private generationNumber = 0;

  constructor(private readonly queries: QueryClient) {}

  private clearPrivateState() {
    this.generation.abort(new ObsoleteSessionError());
    this.generation = new AbortController();
    this.generationNumber += 1;
    void this.queries.cancelQueries({
      predicate: (query) => query.queryKey[0] !== 'session',
    });
    this.queries.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'session',
    });
    this.queries.getMutationCache().clear();
  }

  replace(value: Session | null) {
    // Rotate before cancellation so even a transport ignoring abort cannot publish.
    this.clearPrivateState();
    void this.queries.cancelQueries({ queryKey: sessionKey });
    this.queries.setQueryData(sessionKey, value);
  }

  scope(): SessionScope {
    const generation = this.generation;
    const assertCurrent = () => {
      if (generation !== this.generation) throw new ObsoleteSessionError();
    };
    return {
      generation: this.generationNumber,
      assertCurrent,
      run: async <T>(
        request: (signal: AbortSignal) => Promise<T>,
        signal?: AbortSignal,
      ) => {
        assertCurrent();
        const combined = AbortSignal.any([
          generation.signal,
          ...(signal ? [signal] : []),
        ]);
        try {
          combined.throwIfAborted();
          const result = await request(combined);
          assertCurrent();
          combined.throwIfAborted();
          return result;
        } catch (cause) {
          assertCurrent();
          combined.throwIfAborted();
          if (cause instanceof RequestError && cause.status === 401) {
            this.replace(null);
          }
          throw cause;
        }
      },
    };
  }

  async read(signal: AbortSignal): Promise<Session | null> {
    const scope = this.scope();
    const result = await scope.run(getSession, signal);
    scope.assertCurrent();
    if (result === null) this.clearPrivateState();
    return result;
  }

  async signIn(email: string, password: string): Promise<void> {
    const scope = this.scope();
    const result = await scope.run((signal) => signIn(email, password, signal));
    scope.assertCurrent();
    this.replace(result);
  }

  async signOut(): Promise<void> {
    const scope = this.scope();
    try {
      await scope.run(signOut);
      scope.assertCurrent();
      this.replace(null);
    } catch (cause) {
      // A protected 401 already performed the same cleanup as successful logout.
      if (!(cause instanceof RequestError && cause.status === 401)) throw cause;
    }
  }
}

const states = new WeakMap<QueryClient, SessionState>();
export function sessionStateFor(queries: QueryClient): SessionState {
  let state = states.get(queries);
  if (!state) {
    state = new SessionState(queries);
    states.set(queries, state);
  }
  return state;
}
