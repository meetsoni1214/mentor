import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ConversationSubmission } from './conversation-submission';
import type { createConversationQueries } from './conversation-queries';

export function useConversationSubmission(
  conversation: ReturnType<typeof createConversationQueries>,
) {
  const queries = useQueryClient();
  const [submission] = useState(
    () =>
      new ConversationSubmission({
        assertCurrent: conversation.assertCurrent,
        submit: conversation.submit,
        refresh: async () => {
          conversation.assertCurrent();
          const options = conversation.historyOptions();
          // Reconciliation must read after the write, not reuse a pre-admission GET.
          await queries.cancelQueries({
            queryKey: options.queryKey,
            exact: true,
          });
          conversation.assertCurrent();
          return queries.fetchQuery({ ...options, staleTime: 0 });
        },
      }),
  );
  const state = useSyncExternalStore(
    submission.subscribe,
    submission.getSnapshot,
    submission.getSnapshot,
  );
  useEffect(() => () => submission.reset(), [submission]);
  return { submission, state };
}
