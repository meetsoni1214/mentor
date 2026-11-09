import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ObsoleteSessionError } from '../../auth/session-scope';
import type { SessionScope } from '../../auth/session-scope';
import { memoryCommand } from '../api/memory-contracts';
import { createMemoryQueries } from './memory-queries';
import { memorySaveOptions, memorySaveState } from './memory-save';
import type { MemorySaveAction } from './memory-save';

export function useMemory(
  session: SessionScope,
  clearSubmittedDraft: (revision: number) => void,
) {
  const queries = useQueryClient();
  const [memory] = useState(() => createMemoryQueries(session, queries));
  const lifetime = useRef<AbortController | null>(null);
  // Synchronous guard also covers duplicate actions before React rerenders.
  const active = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort(new ObsoleteSessionError());
  }, []);
  const mutation = useMutation(
    memorySaveOptions({ ...memory, clearSubmittedDraft }, () => {
      if (!lifetime.current) throw new ObsoleteSessionError();
      return lifetime.current.signal;
    }),
  );
  const state = memorySaveState(mutation);
  const run = async (action: MemorySaveAction) => {
    if (active.current) return;
    active.current = true;
    try {
      await mutation.mutateAsync(action);
    } catch {
      /* The mutation result owns the visible failure/recovery state. */
    } finally {
      active.current = false;
    }
  };
  return {
    memory,
    state,
    save: {
      save: (sourceRequest: string, draftRevision: number) => {
        const command = memoryCommand(sourceRequest);
        if (state.pending || !command || command.error) return;
        return run({
          kind: 'save',
          command: {
            input: { requestId: crypto.randomUUID(), sourceRequest },
            draftRevision,
          },
          recovering: false,
        });
      },
      check: () => {
        if (state.phase === 'uncertain' && state.pending)
          return run({
            kind: 'check',
            command: state.pending,
            recovering: true,
          });
      },
      retry: () => {
        if (state.phase === 'uncertain' && state.pending)
          return run({
            kind: 'save',
            command: state.pending,
            recovering: true,
          });
      },
    },
  };
}
