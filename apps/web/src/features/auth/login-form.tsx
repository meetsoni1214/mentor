import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Alert, AlertDescription } from '../../components/ui/alert';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { AuthError } from './auth-api';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

export function LoginForm({
  onSignIn,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
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
      await onSignIn(input.data.email, input.data.password);
      setPassword('');
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
          <Label htmlFor="email">Email</Label>
          <Input
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
          <Label htmlFor="password">Password</Label>
          <Input
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
          <Alert id="login-error" className="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button className="w-full" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </>
  );
}
