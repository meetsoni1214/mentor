import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { SessionScope } from '../../auth/session-scope';
import {
  findSavedMemory,
  getMemory,
  listMemories,
  saveMemory,
  editMemory,
  forgetMemory,
} from '../api/memory-api';
import type {
  MemoryRecord,
  MemorySnapshot,
  SaveMemoryInput,
  EditMemoryInput,
  ForgetMemoryInput,
} from '../api/memory-contracts';

export function createMemoryQueries(
  session: SessionScope,
  queries: QueryClient,
) {
  const root = ['memory', session.generation] as const;
  return {
    assertCurrent: session.assertCurrent,
    listOptions: () =>
      queryOptions({
        queryKey: [...root, 'list'],
        queryFn: ({ signal }) => session.run(listMemories, signal),
        retry: false,
      }),
    find: (id: string, signal: AbortSignal) =>
      session.run((scopeSignal) => findSavedMemory(id, scopeSignal), signal),
    save: (input: SaveMemoryInput, signal: AbortSignal) =>
      session.run((scopeSignal) => saveMemory(input, scopeSignal), signal),
    read: (id: string, signal: AbortSignal) =>
      session.run((scopeSignal) => getMemory(id, scopeSignal), signal),
    edit: (id: string, input: EditMemoryInput, signal: AbortSignal) =>
      session.run((scopeSignal) => editMemory(id, input, scopeSignal), signal),
    forget: (id: string, input: ForgetMemoryInput, signal: AbortSignal) =>
      session.run(
        (scopeSignal) => forgetMemory(id, input, scopeSignal),
        signal,
      ),
    changed: (entry?: MemoryRecord) => {
      session.assertCurrent();
      if (entry) {
        // Publish only a committed response; a slow read must not restore its old wording.
        void queries.cancelQueries({ queryKey: root });
        queries.setQueryData<MemorySnapshot>(
          [...root, 'list'],
          (current) =>
            current && {
              ...current,
              entries:
                'state' in entry
                  ? current.entries.filter((value) => value.id !== entry.id)
                  : current.entries.map((value) =>
                      value.id === entry.id ? entry : value,
                    ),
            },
        );
      }
      void queries.invalidateQueries({ queryKey: root });
    },
  };
}
