import { mutationOptions } from '@tanstack/react-query';
import type { MutationObserverResult } from '@tanstack/react-query';
import { ObsoleteSessionError } from '../../auth/session-scope';
import { RequestError } from '../../../lib/api-request';
import { MemoryApiError } from '../api/memory-api';
import type { MemoryEntry, SaveMemoryInput } from '../api/memory-contracts';

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
      const signal = AbortSignal.any([lifetime(), AbortSignal.timeout(15_000)]);
      let rejectAborted!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        rejectAborted = () => reject(signal.reason);
        signal.addEventListener('abort', rejectAborted, { once: true });
      });
      try {
        port.assertCurrent();
        signal.throwIfAborted();
        const entry = await Promise.race([
          kind === 'save'
            ? port.save(command.input, signal)
            : port.find(command.input.requestId, signal),
          aborted,
        ]);
        signal.throwIfAborted();
        port.assertCurrent();
        if (entry.sourceRequest !== command.input.sourceRequest)
          throw new Error('Mismatched saved memory.');
        return entry;
      } finally {
        signal.removeEventListener('abort', rejectAborted);
      }
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
  if (
    error instanceof ObsoleteSessionError ||
    (error instanceof RequestError && error.status === 401)
  )
    return { phase: 'idle', pending: null, notice: '' };
  // A rejected replay does not establish that the earlier uncertain save failed.
  if (
    !action.recovering &&
    (error instanceof MemoryApiError ||
      (error instanceof RequestError &&
        [400, 403, 413, 415, 422, 429].includes(error.status)))
  )
    return { phase: 'rejected', pending: null, notice: error.message };
  return {
    phase: 'uncertain',
    pending: action.command,
    notice:
      error instanceof MemoryApiError && error.code === 'NOT_FOUND'
        ? 'No saved request was found yet. The original save may still finish. Check again or retry the exact original save.'
        : 'Memory save is unconfirmed. Check the saved request or explicitly retry the exact original save. Your draft is kept.',
  };
}
