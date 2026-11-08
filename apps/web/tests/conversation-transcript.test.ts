import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { ConversationHistory } from '../src/features/conversation/api/conversation-contracts';
import { ConversationTranscript } from '../src/features/conversation/ui/conversation-transcript';
import { completed, historyOf } from './fixtures/conversation-stream';

function renderTranscript(loaded: boolean, resettingHistory: boolean) {
  const queries = new QueryClient();
  const saved = historyOf(completed);
  if (loaded) queries.setQueryData(['history'], saved);
  const observer = new QueryObserver<ConversationHistory>(queries, {
    queryKey: ['history'],
    queryFn: async () => saved,
  });
  const html = renderToStaticMarkup(
    createElement(ConversationTranscript, {
      history: {
        head: observer.getCurrentResult(),
        turns: loaded ? saved.turns : [],
        nextCursor: null,
        loadingOlder: false,
        olderError: undefined,
        retryOlder: () => undefined,
        loadOlder: () => {},
      },
      resettingHistory,
      acceptedRequestId: null,
      provisional: null,
      retryTurnId: null,
      pendingRetryTurnId: null,
      retryDisabled: false,
      onRetry: () => {},
    }),
  );
  queries.clear();
  return html;
}

describe('conversation presentation while confirmed clearing refreshes history', () => {
  for (const loaded of [true, false]) {
    it(`keeps the empty layout without old content or a loading screen when cached history is ${loaded ? 'obsolete' : 'removed'}`, () => {
      const html = renderTranscript(loaded, true);
      expect(html).toContain('No messages yet.');
      expect(html).not.toContain('Loading your conversation');
      expect(html).not.toContain(completed.turn.text);
      expect(html).not.toContain(completed.attempt.answer);
    });
  }

  it('still distinguishes initial loading and normally loaded history', () => {
    expect(renderTranscript(false, false)).toContain(
      'Loading your conversation',
    );
    expect(renderTranscript(true, false)).toContain(completed.turn.text);
  });
});
