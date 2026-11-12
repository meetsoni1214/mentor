import { ObsoleteSessionError } from '../../auth/session-scope';
import { RequestError } from '../../../lib/api-request';
import { MemoryApiError } from '../api/memory-api';

export async function runMemoryRequest<T>(
  lifetime: AbortSignal,
  assertCurrent: () => void,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000)]);
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    signal.throwIfAborted();
    assertCurrent();
    const result = await Promise.race([request(signal), aborted]);
    signal.throwIfAborted();
    assertCurrent();
    return result;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export function isMemoryVersionError(error: unknown): boolean {
  return (
    error instanceof MemoryApiError &&
    ['ENTRY_CHANGED', 'FORGOTTEN'].includes(error.code)
  );
}

export function memoryFailure(error: unknown, recovering: boolean) {
  if (
    error instanceof ObsoleteSessionError ||
    (error instanceof RequestError && error.status === 401)
  )
    return 'session-ended';
  // A rejected replay cannot disprove an earlier uncertain write.
  if (
    isMemoryVersionError(error) ||
    (!recovering &&
      (error instanceof MemoryApiError ||
        (error instanceof RequestError &&
          [400, 403, 413, 415, 422, 429].includes(error.status))))
  )
    return 'rejected';
  return 'uncertain';
}
