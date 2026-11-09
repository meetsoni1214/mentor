export const memoryLimits = Object.freeze({
  maxEntries: 20,
  maxEntryBytes: 512,
  maxProfileBytes: 4096,
  maxRequestBytes: 1024,
});

export type MemoryErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSY'
  | 'LIMIT_EXCEEDED';

export class MemoryError extends Error {
  constructor(readonly code: MemoryErrorCode) {
    super(code);
  }
}

export function wordingBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function explicitMemoryWording(request: string): string {
  // PostgreSQL text cannot retain NUL or unpaired UTF-16 surrogates exactly.
  if (
    /[\uD800-\uDFFF]/u.test(request) ||
    request.includes('\0') ||
    wordingBytes(request) > memoryLimits.maxRequestBytes ||
    !/^remember that /i.test(request)
  )
    throw new MemoryError('INVALID_INPUT');
  const text = request.slice('Remember that '.length).trim();
  if (!text || wordingBytes(text) > memoryLimits.maxEntryBytes)
    throw new MemoryError('INVALID_INPUT');
  return text;
}

export function assertProfileCapacity(texts: string[], text: string): void {
  if (
    texts.length >= memoryLimits.maxEntries ||
    texts.reduce((total, value) => total + wordingBytes(value), 0) +
      wordingBytes(text) >
      memoryLimits.maxProfileBytes
  )
    throw new MemoryError('LIMIT_EXCEEDED');
}

export interface MemoryEntry {
  id: string;
  requestId: string;
  text: string;
  sourceRequest: string;
  createdAt: Date;
}
