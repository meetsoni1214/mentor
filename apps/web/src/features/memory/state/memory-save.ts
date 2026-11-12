import { mutationOptions } from '@tanstack/react-query';
import type { MutationObserverResult } from '@tanstack/react-query';
import { MemoryApiError } from '../api/memory-api';
import type { MemoryEntry, SaveMemoryInput } from '../api/memory-contracts';
import {
  isMemoryVersionError,
  memoryFailure,
  runMemoryRequest,
} from './memory-recovery';

type PendingSave = { input: SaveMemoryInput; draftRevision: number };
export type MemorySaveAction = {
  kind: 'save' | 'check';
  command: PendingSave;
  recovering: boolean;
};
export interface MemorySaveState {
  phase: 'idle' | 'saving' | 'checking' | 'uncertain' | 'saved' | 'rejected';
  pending: PendingSave | null;
  notice: string;
}
interface MemorySavePort {
  assertCurrent(): void;
  save(input: SaveMemoryInput, signal: AbortSignal): Promise<MemoryEntry>;
  find(requestId: string, signal: AbortSignal): Promise<MemoryEntry>;
  changed(): void;
  clearSubmittedDraft(revision: number): void;
}

export function memorySaveOptions(
  port: MemorySavePort,
  lifetime: () => AbortSignal,
) {
  return mutationOptions({
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: async ({ kind, command }: MemorySaveAction) => {
      const entry = await runMemoryRequest(
        lifetime(),
        port.assertCurrent,
        (signal) =>
          kind === 'save'
            ? port.save(command.input, signal)
            : port.find(command.input.requestId, signal),
      );
      if (entry.sourceRequest !== command.input.sourceRequest)
        throw new Error('Mismatched saved memory.');
      return entry;
    },
    onError: (error) => {
      if (isMemoryVersionError(error)) port.changed();
    },
    onSuccess: (_entry, { command }) => {
      port.assertCurrent();
      lifetime().throwIfAborted();
      port.clearSubmittedDraft(command.draftRevision);
      port.changed();
    },
  });
}

export function memorySaveState(
  result: Pick<
    MutationObserverResult<MemoryEntry, Error, MemorySaveAction>,
    'variables' | 'isIdle' | 'isPending' | 'isSuccess' | 'error'
  >,
): MemorySaveState {
  const action = result.variables;
  if (!action || result.isIdle)
    return { phase: 'idle', pending: null, notice: '' };
  if (result.isPending)
    return {
      phase: action.kind === 'save' ? 'saving' : 'checking',
      pending: action.command,
      notice:
        action.kind === 'save' ? 'Saving memory…' : 'Checking saved request…',
    };
  if (result.isSuccess)
    return {
      phase: 'saved',
      pending: null,
      notice: 'Memory saved.',
    };
  const error = result.error;
  const failure = memoryFailure(error, action.recovering);
  if (failure === 'session-ended')
    return { phase: 'idle', pending: null, notice: '' };
  if (failure === 'rejected')
    return { phase: 'rejected', pending: null, notice: error?.message ?? '' };
  return {
    phase: 'uncertain',
    pending: action.command,
    notice:
      error instanceof MemoryApiError && error.code === 'NOT_FOUND'
        ? 'No saved request was found yet. The original save may still finish. Check again or retry the exact original save.'
        : 'Memory save is unconfirmed. Check the saved request or explicitly retry the exact original save. Your draft is kept.',
  };
}
