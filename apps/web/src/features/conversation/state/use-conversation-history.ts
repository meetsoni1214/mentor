import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type {
  ConversationHistory,
  HistoryCursor,
} from '../api/conversation-contracts';
import type { createConversationQueries } from './conversation-queries';
import { conversationPollInterval } from './conversation-polling';

export type ConversationQueries = ReturnType<typeof createConversationQueries>;

export function useConversationHistory(
  conversation: ConversationQueries,
  deliveryPending = false,
  liveAttemptId?: string,
) {
  const head = useQuery({
    ...conversation.historyOptions(),
    refetchInterval: (query) =>
      conversationPollInterval(
        query.state.data,
        deliveryPending,
        liveAttemptId,
      ),
    refetchIntervalInBackground: false,
  });
  const [requestedPages, setRequestedPages] = useState<HistoryCursor[]>([]);
  // A clear in another tab can replace the head while older pages are mounted.
  const cursors = requestedPages.filter(
    (cursor) => cursor.historyVersion === head.data?.historyVersion,
  );
  const pages = useQueries({
    queries: cursors.map((cursor) => conversation.historyOptions({ cursor })),
  });
  const oldest = pages.at(-1);
  const loadingOlder = pages.some((page) => page.isFetching);
  const failedPage = pages.find((page) => page.isError);
  const nextCursor = oldest ? oldest.data?.nextCursor : head.data?.nextCursor;
  const turns = new Map<string, ConversationHistory['turns'][number]>();
  // The head wins overlapping page boundaries after a refetch.
  for (const data of [...pages.map((page) => page.data), head.data]) {
    if (data?.historyVersion !== head.data?.historyVersion) continue;
    for (const turn of data?.turns ?? []) turns.set(turn.id, turn);
  }

  return {
    head,
    turns: [...turns.values()].sort((a, b) => a.sequence - b.sequence),
    nextCursor,
    loadingOlder,
    olderError: failedPage?.error,
    retryOlder: () => failedPage?.refetch(),
    loadOlder: () => {
      if (!nextCursor || loadingOlder || failedPage) return;
      setRequestedPages([...cursors, nextCursor]);
    },
  };
}
