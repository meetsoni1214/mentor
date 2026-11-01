import {
  apiClient as client,
  csrfToken,
  RequestError,
  requestFailure,
} from '../../lib/api-request';
import { z } from 'zod';

const sessionSchema = z.object({
  owner: z.object({ id: z.uuid(), email: z.email() }),
  expiresAt: z.iso.datetime(),
  idleExpiresAt: z.iso.datetime(),
});
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

export async function getSession(signal: AbortSignal): Promise<Session | null> {
  try {
    const { data, response } = await client.GET('/api/v1/auth/session', {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) throw requestFailure(response);
    return sessionSchema.parse(data);
  } catch (cause) {
    if (cause instanceof RequestError && cause.status === 401) return null;
    throw cause;
  }
}

export async function signIn(
  email: string,
  password: string,
  signal: AbortSignal,
): Promise<Session> {
  try {
    const token = await csrfToken(signal);
    signal.throwIfAborted();
    const { data, response } = await client.POST('/api/v1/auth/login', {
      body: { email, password },
      params: { header: { 'X-CSRF-Token': token } },
      signal,
      cache: 'no-store',
    });
    if (!response.ok) throw requestFailure(response);
    return sessionSchema.parse(data);
  } catch (cause) {
    if (cause instanceof RequestError) {
      throw new AuthError(cause.status, cause.retryAfterSeconds);
    }
    throw cause;
  }
}

export async function signOut(signal: AbortSignal): Promise<void> {
  const token = await csrfToken(signal);
  signal.throwIfAborted();
  const { response } = await client.POST('/api/v1/auth/logout', {
    params: { header: { 'X-CSRF-Token': token } },
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw requestFailure(response);
}
