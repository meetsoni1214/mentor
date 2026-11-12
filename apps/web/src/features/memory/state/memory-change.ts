import { mutationOptions } from '@tanstack/react-query';
import { MemoryApiError } from '../api/memory-api';
import type {
  EditMemoryInput,
  ForgetMemoryInput,
} from '../api/memory-contracts';
import type { createMemoryQueries } from './memory-queries';
import { isMemoryVersionError, runMemoryRequest } from './memory-recovery';

export type MemoryChangeCommand =
  | { kind: 'edit'; entryId: string; input: EditMemoryInput }
  | { kind: 'forget'; entryId: string; input: ForgetMemoryInput };
export type MemoryChangeAction = {
  command: MemoryChangeCommand;
  check: boolean;
  recovering: boolean;
};

export function memoryChangeOptions(
  memory: ReturnType<typeof createMemoryQueries>,
  lifetime: () => AbortSignal,
  onCommitted: () => void = () => {},
) {
  return mutationOptions({
    retry: false,
    networkMode: 'always',
    gcTime: 0,
    mutationFn: async ({ command, check }: MemoryChangeAction) => {
      const entry = await runMemoryRequest(
        lifetime(),
        memory.assertCurrent,
        (signal) =>
          check
            ? memory.read(command.entryId, signal)
            : command.kind === 'edit'
              ? memory.edit(command.entryId, command.input, signal)
              : memory.forget(command.entryId, command.input, signal),
      );
      if ('state' in entry) {
        if (command.kind === 'edit') throw new MemoryApiError(410, 'FORGOTTEN');
        return entry;
      }
      if (
        entry.revision === command.input.expectedRevision + 1 &&
        entry.lastMutationRequestId === command.input.requestId &&
        command.kind === 'edit' &&
        entry.sourceRequest === command.input.sourceRequest
      )
        return entry;
      if (entry.revision !== command.input.expectedRevision)
        throw new MemoryApiError(409, 'ENTRY_CHANGED');
      throw new Error('The change is still unconfirmed.');
    },
    onSuccess: (entry) => {
      memory.assertCurrent();
      lifetime().throwIfAborted();
      memory.changed(entry);
      onCommitted();
    },
    onError: (error) => {
      if (isMemoryVersionError(error)) memory.changed();
    },
  });
}
