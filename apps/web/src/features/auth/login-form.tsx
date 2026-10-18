'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { AuthError, signIn } from './auth-api';
import type { Session } from './auth-api';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

export function LoginForm({
  onSignedIn,
}: {
  onSignedIn: (session: Session) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const input = credentialsSchema.safeParse({ email, password });
    if (!input.success) {
      setError('Enter a valid email and your password.');
      return;
    }
    setPending(true);
    setError('');
    try {
      // Keep passwords out of query/mutation caches and browser storage.
      const session = await signIn(input.data.email, input.data.password);
      setPassword('');
      await onSignedIn(session);
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : 'Unable to sign in. Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1>Welcome back.</h1>
      <p className="intro">Sign in to your personal space.</p>
      <form
        onSubmit={submit}
        aria-busy={pending}
        aria-describedby={error ? 'login-error' : undefined}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
        </div>
        {error && (
          <p id="login-error" className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </>
  );
}
