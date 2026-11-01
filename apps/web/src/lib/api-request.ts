import { createApiClient } from '@mentor/api-client';
import { z } from 'zod';

export const apiClient = createApiClient();
const csrfSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds = 0,
  ) {
    super(
      status === 401
        ? 'Your session expired. Sign in again.'
        : status === 403
          ? 'Your request expired or came from a different address. Refresh and try again.'
          : 'The request could not be completed. Please try again.',
    );
  }
}

export function requestFailure(response: Response): RequestError {
  const seconds = Number(response.headers.get('Retry-After') ?? '0');
  return new RequestError(
    response.status,
    Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
  );
}

export async function csrfToken(signal: AbortSignal): Promise<string> {
  const { data, response } = await apiClient.GET('/api/v1/auth/csrf', {
    signal,
    cache: 'no-store',
  });
  signal.throwIfAborted();
  if (!response.ok) throw requestFailure(response);
  return csrfSchema.parse(data).token;
}

// Origin is also supplied/enforced by the browser; the generated contract requires it.
export function mutationHeaders(token: string) {
  return { 'X-CSRF-Token': token, Origin: window.location.origin };
}

// Inspect auth status before JSON decoding, including empty or malformed error bodies.
apiClient.use({
  onResponse({ response }) {
    if (response.status === 401 || response.status === 403) {
      throw requestFailure(response);
    }
  },
});
