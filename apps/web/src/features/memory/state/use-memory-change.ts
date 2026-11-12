import { useMutation } from '@tanstack/react-query';
import { MemoryApiError } from '../api/memory-api';
import { memoryChangeOptions } from './memory-change';
import type { MemoryChangeAction, MemoryChangeCommand } from './memory-change';
import type { createMemoryQueries } from './memory-queries';
import { memoryFailure } from './memory-recovery';
import { useMemoryOperation } from './use-memory-operation';

export function useMemoryChange(
  memory: ReturnType<typeof createMemoryQueries>,
  onCommitted: () => void,
) {
  const operation = useMemoryOperation();
  const mutation = useMutation(
    memoryChangeOptions(memory, operation.signal, onCommitted),
  );
  const error = mutation.error;
  const uncertain =
    mutation.isError &&
    memoryFailure(error, mutation.variables.recovering) === 'uncertain';
  const run = (action: MemoryChangeAction) =>
    operation.run(() => mutation.mutateAsync(action));
  return {
    pending: mutation.isPending,
    uncertain,
    conflict: error instanceof MemoryApiError && error.code === 'ENTRY_CHANGED',
    forgotten: error instanceof MemoryApiError && error.code === 'FORGOTTEN',
    notice: mutation.isPending
      ? mutation.variables.check
        ? 'Checking…'
        : 'Saving…'
      : uncertain
        ? 'This change is unconfirmed. Check it or retry.'
        : (error?.message ?? ''),
    start: (command: MemoryChangeCommand) => {
      if (!uncertain && !mutation.isPending)
        return run({ command, check: false, recovering: false });
    },
    check: () => {
      if (uncertain && mutation.variables)
        return run({ ...mutation.variables, check: true, recovering: true });
    },
    retry: () => {
      if (uncertain && mutation.variables)
        return run({ ...mutation.variables, check: false, recovering: true });
    },
    reset: () => {
      if (!uncertain && !mutation.isPending) mutation.reset();
    },
  };
}
