import { createApiClient } from '@mentor/api-client';
import { z } from 'zod';

const client = createApiClient();
const sessionSchema = z.object({
  owner: z.object({ id: z.uuid(), email: z.email() }),
  expiresAt: z.iso.datetime(),
  idleExpiresAt: z.iso.datetime(),
});
const csrfSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export type Session = z.infer<typeof sessionSchema>;

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds = 0,
  ) {
    super(
      status === 401
        ? 'The email or password is incorrect.'
        : status === 429
          ? `Too many attempts. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minutes.`
          : status === 403
            ? 'Your sign-in request expired or came from a different address. Refresh and try again.'
            : 'We could not reach your account. Please try again.',
    );
  }
}

function failure(response: Response): AuthError {
  const seconds = Number(response.headers.get('Retry-After') ?? '0');
  return new AuthError(response.status, Number.isFinite(seconds) ? seconds : 0);
}

export async function getSession(signal: AbortSignal): Promise<Session | null> {
  const { data, response } = await client.GET('/api/v1/auth/session', {
    signal,
    cache: 'no-store',
  });
  if (response.status === 401) return null;
  if (!response.ok) throw failure(response);
  return sessionSchema.parse(data);
}

async function csrfToken(): Promise<string> {
  const { data, response } = await client.GET('/api/v1/auth/csrf', {
    cache: 'no-store',
  });
  if (!response.ok) throw failure(response);
  return csrfSchema.parse(data).token;
}

export async function signIn(
  email: string,
  password: string,
): Promise<Session> {
  const token = await csrfToken();
  const { data, response } = await client.POST('/api/v1/auth/login', {
    body: { email, password },
    params: { header: { 'X-CSRF-Token': token } },
    cache: 'no-store',
  });
  if (!response.ok) throw failure(response);
  return sessionSchema.parse(data);
}

export async function signOut(): Promise<void> {
  const token = await csrfToken();
  const { response } = await client.POST('/api/v1/auth/logout', {
    params: { header: { 'X-CSRF-Token': token } },
    cache: 'no-store',
  });
  if (!response.ok && response.status !== 401) throw failure(response);
}
