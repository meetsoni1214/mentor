import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { SessionScope } from '../../auth/session-scope';
import {
  findSavedMemory,
  getMemory,
  listMemories,
  saveMemory,
} from '../api/memory-api';
import type { SaveMemoryInput } from '../api/memory-contracts';

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
    detailOptions: (id: string) =>
      queryOptions({
        queryKey: [...root, 'detail', id],
        queryFn: ({ signal }) =>
          session.run((scopeSignal) => getMemory(id, scopeSignal), signal),
        retry: false,
      }),
    find: (id: string, signal: AbortSignal) =>
      session.run((scopeSignal) => findSavedMemory(id, scopeSignal), signal),
    save: (input: SaveMemoryInput, signal: AbortSignal) =>
      session.run((scopeSignal) => saveMemory(input, scopeSignal), signal),
    changed: () => {
      session.assertCurrent();
      void queries.invalidateQueries({ queryKey: root });
    },
  };
}
