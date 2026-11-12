import {
  memoryLimits,
  parseMemoryCommand,
  wordingBytes,
} from '@mentor/memory-command';
export { memoryLimits } from '@mentor/memory-command';

export type MemoryErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ENTRY_CHANGED'
  | 'FORGOTTEN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSY'
  | 'LIMIT_EXCEEDED';

export class MemoryError extends Error {
  constructor(readonly code: MemoryErrorCode) {
    super(code);
  }
}

export function explicitMemoryWording(request: string): string {
  const command = parseMemoryCommand(request);
  if (!command?.valid) throw new MemoryError('INVALID_INPUT');
  return command.text;
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
  revision: number;
  lastMutationRequestId: string | null;
}

export interface ForgottenMemory {
  state: 'forgotten';
  id: string;
  requestId: string;
  revision: number;
  lastMutationRequestId: string | null;
  forgottenAt: Date;
}
export type MemoryRecord = MemoryEntry | ForgottenMemory;
export function isForgotten(entry: MemoryRecord): entry is ForgottenMemory {
  return 'state' in entry;
}
