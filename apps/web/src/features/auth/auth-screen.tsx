'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { BrandLockup } from '../../brand/brand-logo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RequestError } from '../../lib/api-request';
import { sessionKey, sessionStateFor } from './session-state';
import { LoginForm } from './login-form';
import { ConversationWorkspace } from '../conversation/conversation-workspace';

export function AuthScreen() {
  const queryClient = useQueryClient();
  const sessionState = sessionStateFor(queryClient);
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => sessionState.read(signal),
    retry: false,
    staleTime: 0,
  });
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session.data) return;
    const delay =
      Math.max(0, Date.parse(session.data.idleExpiresAt) - Date.now()) + 100;
    const timeout = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: sessionKey });
    }, delay);
    return () => clearTimeout(timeout);
  }, [session.data, queryClient]);

  async function logout() {
    setSigningOut(true);
    setError('');
    try {
      await sessionState.signOut();
    } catch (cause) {
      setError(
        cause instanceof RequestError
          ? cause.message
          : 'Unable to sign out. Check your connection and try again.',
      );
    } finally {
      setSigningOut(false);
    }
  }

  if (session.data && !session.isError) {
    const scope = sessionState.scope();
    return (
      <ConversationWorkspace
        key={scope.generation}
        session={scope}
        onSignOut={() => void logout()}
        signingOut={signingOut}
        signOutError={error}
      />
    );
  }

  return (
    <main className="auth-shell">
      <BrandLockup className="auth-brand" />
      {session.isPending ? (
        <p role="status">Opening your space…</p>
      ) : session.isError ? (
        <>
          <h1>Let’s reconnect.</h1>
          <Alert className="mb-4">
            <AlertDescription>
              Your account could not be reached. Please try again.
            </AlertDescription>
          </Alert>
          <Button
            onClick={() => void session.refetch()}
            disabled={session.isFetching}
          >
            {session.isFetching ? 'Reconnecting…' : 'Try again'}
          </Button>
        </>
      ) : (
        <LoginForm
          onSignIn={async (email, password) => {
            await sessionState.signIn(email, password);
            setError('');
          }}
        />
      )}
    </main>
  );
}
