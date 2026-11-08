import { hashKey, queryOptions } from '@tanstack/react-query';
import type {
  QueryClient,
  QueryFilters,
  QueryKey,
} from '@tanstack/react-query';
import type { SessionScope } from '../auth/session-scope';
import {
  clearConversationHistory,
  getAssistantStatus,
  getConversationHistory,
  retryConversationTurn,
  submitConversationTurn,
} from './conversation-api';
import type {
  ClearInput,
  HistoryOptions,
  RetryInput,
  SubmitInput,
  TurnResult,
  ConversationHistory,
} from './conversation-contracts';
import { ConversationScope } from './conversation-scope';
import { streamConversationTurn } from './conversation-stream-api';
import type { ConversationStreamProgress } from './conversation-stream-contracts';

export function createConversationQueries(
  session: SessionScope,
  queries: QueryClient,
) {
  const scope = new ConversationScope(session);
  const root = ['conversation', session.generation] as const;
  const historyRoot = [...root, 'history'] as const;
  const keys = {
    all: root,
    histories: historyRoot,
    status: [...root, 'status'] as const,
    history: (options: HistoryOptions = {}) =>
      options.cursor
        ? ([
            ...historyRoot,
            'page',
            options.cursor.historyVersion,
            options.cursor.beforeSequence,
            options.limit ?? null,
          ] as const)
        : ([...historyRoot, 'head', options.limit ?? null] as const),
  };

  function discardObsoleteHistory(version: number, sourceKey?: QueryKey) {
    const sourceHash = sourceKey ? hashKey(sourceKey) : undefined;
    const obsolete: QueryFilters = {
      queryKey: historyRoot,
      predicate: (query) => {
        // The head read delivering the new version must finish and enter the cache.
        if (query.queryHash === sourceHash) return false;
        if (query.queryKey[3] === 'page') return query.queryKey[4] !== version;
        const data = query.state.data;
        return !(
          data &&
          typeof data === 'object' &&
          'historyVersion' in data &&
          data.historyVersion === version
        );
      },
    };
    void queries.cancelQueries(obsolete);
    queries.removeQueries(obsolete);
    const mutations = queries.getMutationCache();
    for (const mutation of mutations.findAll({ mutationKey: root }))
      mutations.remove(mutation);
  }

  async function historyRequest<T extends { historyVersion: number }>(
    request: (signal: AbortSignal) => Promise<T>,
    expectedVersion?: number,
    signal?: AbortSignal,
    sourceKey?: QueryKey,
  ) {
    const { value, historyChanged } = await scope.run(
      request,
      expectedVersion,
      signal,
    );
    scope.assertCurrent(value.historyVersion);
    if (historyChanged) discardObsoleteHistory(value.historyVersion, sourceKey);
    return value;
  }

  function history(
    options: HistoryOptions = {},
    signal?: AbortSignal,
    sourceKey?: QueryKey,
  ) {
    return historyRequest(
      (requestSignal) => getConversationHistory(options, requestSignal),
      options.cursor?.historyVersion,
      signal,
      sourceKey,
    );
  }

  function status(signal?: AbortSignal) {
    return session.run(getAssistantStatus, signal);
  }

  return {
    keys,
    assertCurrent: (version?: number) => scope.assertCurrent(version),
    status,
    history: (options?: HistoryOptions, signal?: AbortSignal) =>
      history(options, signal),
    statusOptions: () =>
      queryOptions({
        queryKey: keys.status,
        queryFn: ({ signal }) => status(signal),
        retry: false,
      }),
    historyOptions: (options: HistoryOptions = {}) => {
      const key = keys.history(options);
      return queryOptions({
        queryKey: key,
        queryFn: ({ signal }) => history(options, signal, key),
        retry: false,
      });
    },
    submit: (input: SubmitInput, signal?: AbortSignal) =>
      historyRequest(
        (requestSignal) => submitConversationTurn(input, requestSignal),
        input.historyVersion,
        signal,
      ),
    stream: (
      input: SubmitInput,
      onProgress: (event: ConversationStreamProgress) => void,
      signal?: AbortSignal,
    ) =>
      historyRequest(
        (requestSignal) =>
          streamConversationTurn(
            input,
            (event) => {
              scope.assertCurrent(input.historyVersion);
              requestSignal.throwIfAborted();
              onProgress(event);
            },
            requestSignal,
          ),
        input.historyVersion,
        signal,
      ),
    publish: (result: TurnResult) => {
      scope.assertCurrent(result.historyVersion);
      const key = keys.history();
      // An older in-flight read must not replace a just-committed stream result.
      void queries.cancelQueries({ queryKey: key, exact: true });
      queries.setQueryData<ConversationHistory>(key, (current) => {
        if (!current || current.historyVersion !== result.historyVersion)
          return current;
        const existing = current.turns.find(
          (turn) => turn.id === result.turn.id,
        );
        const previous = existing?.attempts.find(
          (attempt) => attempt.id === result.attempt.id,
        );
        if (
          previous &&
          previous.state !== 'running' &&
          result.attempt.state === 'running'
        )
          return current;
        const attempts = [
          ...(existing?.attempts.filter(
            (attempt) => attempt.id !== result.attempt.id,
          ) ?? []),
          result.attempt,
        ];
        return {
          ...current,
          turns: [
            ...current.turns.filter((turn) => turn.id !== result.turn.id),
            { ...result.turn, attempts },
          ].sort((a, b) => a.sequence - b.sequence),
        };
      });
    },
    retry: (turnId: string, input: RetryInput, signal?: AbortSignal) =>
      historyRequest(
        (requestSignal) => retryConversationTurn(turnId, input, requestSignal),
        input.historyVersion,
        signal,
      ),
    clear: (input: ClearInput, signal?: AbortSignal) =>
      historyRequest(
        (requestSignal) => clearConversationHistory(input, requestSignal),
        input.historyVersion,
        signal,
      ),
  };
}
