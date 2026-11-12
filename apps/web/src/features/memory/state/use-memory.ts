import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionScope } from '../../auth/session-scope';
import { memoryCommand } from '../api/memory-contracts';
import { createMemoryQueries } from './memory-queries';
import { memorySaveOptions, memorySaveState } from './memory-save';
import { useMemoryOperation } from './use-memory-operation';

export function useMemory(
  session: SessionScope,
  clearSubmittedDraft: (revision: number) => void,
) {
  const queries = useQueryClient();
  const [memory] = useState(() => createMemoryQueries(session, queries));
  const operation = useMemoryOperation();
  const mutation = useMutation(
    memorySaveOptions({ ...memory, clearSubmittedDraft }, operation.signal),
  );
  const state = memorySaveState(mutation);
  return {
    memory,
    state,
    save: {
      save: (sourceRequest: string, draftRevision: number) => {
        const command = memoryCommand(sourceRequest);
        if (state.pending || !command || command.error) return;
        return operation.run(() =>
          mutation.mutateAsync({
            kind: 'save',
            command: {
              input: { requestId: crypto.randomUUID(), sourceRequest },
              draftRevision,
            },
            recovering: false,
          }),
        );
      },
      check: () => {
        const command = state.pending;
        if (state.phase === 'uncertain' && command)
          return operation.run(() =>
            mutation.mutateAsync({
              kind: 'check',
              command,
              recovering: true,
            }),
          );
      },
      retry: () => {
        const command = state.pending;
        if (state.phase === 'uncertain' && command)
          return operation.run(() =>
            mutation.mutateAsync({
              kind: 'save',
              command,
              recovering: true,
            }),
          );
      },
    },
  };
}
