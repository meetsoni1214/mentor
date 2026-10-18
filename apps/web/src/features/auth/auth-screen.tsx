'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthError, getSession, signOut } from './auth-api';
import type { Session } from './auth-api';
import { LoginForm } from './login-form';

const sessionKey = ['session'] as const;

export function AuthScreen() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => getSession(signal),
    retry: false,
    staleTime: 0,
  });
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session.data === null) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'session',
      });
    }
  }, [session.data, queryClient]);

  useEffect(() => {
    if (!session.data) return;
    const delay =
      Math.max(0, Date.parse(session.data.idleExpiresAt) - Date.now()) + 100;
    const timeout = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: sessionKey });
    }, delay);
    return () => clearTimeout(timeout);
  }, [session.data, queryClient]);

  async function replaceSession(value: Session | null) {
    await queryClient.cancelQueries();
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'session',
    });
    queryClient.setQueryData(sessionKey, value);
    setError('');
  }

  async function logout() {
    setSigningOut(true);
    setError('');
    try {
      await signOut();
      await replaceSession(null);
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : 'Unable to sign out. Check your connection and try again.',
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="auth-shell">
      <p className="eyebrow">MENTOR</p>
      {session.isPending ? (
        <p role="status">Opening your space…</p>
      ) : session.isError ? (
        <>
          <h1>Let’s reconnect.</h1>
          <p role="alert">
            Your account could not be reached. Please try again.
          </p>
          <button
            onClick={() => void session.refetch()}
            disabled={session.isFetching}
          >
            {session.isFetching ? 'Reconnecting…' : 'Try again'}
          </button>
        </>
      ) : session.data ? (
        <>
          <h1>Your space is ready.</h1>
          <p className="intro">
            You’re signed in as <strong>{session.data.owner.email}</strong>.
          </p>
          <p>
            Your notes and conversations will live here as we build the next
            part.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="secondary"
            onClick={() => void logout()}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </>
      ) : (
        <LoginForm onSignedIn={replaceSession} />
      )}
    </main>
  );
}
