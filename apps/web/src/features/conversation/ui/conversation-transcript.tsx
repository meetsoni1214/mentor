import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { brand } from '../../../brand/brand';
import { BrandLogo } from '../../../brand/brand-logo';
import { ConversationApiError } from '../api/conversation-errors';
import { ConversationMessage } from './conversation-message';
import type { useConversationHistory } from '../state/use-conversation-history';
import type { ProvisionalResponse } from '../api/conversation-stream-contracts';

export function ConversationTranscript({
  history,
  acceptedRequestId,
  provisional,
}: {
  history: ReturnType<typeof useConversationHistory>;
  acceptedRequestId: string | null;
  provisional: ProvisionalResponse | null;
}) {
  const scroll = useRef<HTMLElement>(null);
  const positionedVersion = useRef<number | undefined>(undefined);
  const positionedRequest = useRef<string | null>(null);
  const followLatest = useRef(true);
  const anchor = useRef<{
    element: HTMLElement;
    top: number;
    version: number | undefined;
    restoreFocus: boolean;
  } | null>(null);
  const { head, turns } = history;
  const version = head.data?.historyVersion;
  const stalePage =
    history.olderError instanceof ConversationApiError &&
    history.olderError.code === 'STALE_HISTORY';

  useLayoutEffect(() => {
    const container = scroll.current;
    if (!container || version === undefined) return;
    if (positionedVersion.current !== version) {
      container.scrollTop = container.scrollHeight;
      positionedVersion.current = version;
      anchor.current = null;
    } else if (anchor.current && !history.loadingOlder) {
      const previous = anchor.current;
      if (previous.version === version && previous.element.isConnected) {
        container.scrollTop +=
          previous.element.getBoundingClientRect().top - previous.top;
        if (previous.restoreFocus)
          previous.element.focus({ preventScroll: true });
      }
      anchor.current = null;
    } else if (
      (acceptedRequestId !== positionedRequest.current &&
        turns.some((turn) => turn.requestId === acceptedRequestId)) ||
      followLatest.current
    ) {
      container.scrollTop = container.scrollHeight;
      positionedRequest.current = acceptedRequestId;
    }
  }, [
    version,
    turns,
    history.loadingOlder,
    acceptedRequestId,
    provisional?.text,
  ]);

  function rememberReadingPosition() {
    const container = scroll.current;
    if (container) {
      const top = container.getBoundingClientRect().top;
      const visible = [
        ...container.querySelectorAll<HTMLElement>('[data-turn]'),
      ].find((element) => element.getBoundingClientRect().bottom > top);
      if (visible)
        anchor.current = {
          element: visible,
          top: visible.getBoundingClientRect().top,
          version,
          restoreFocus: !!document.activeElement?.closest('.history-controls'),
        };
    }
  }

  function loadOlder() {
    rememberReadingPosition();
    history.loadOlder();
  }

  function retryOlder() {
    rememberReadingPosition();
    void history.retryOlder();
  }

  return (
    <main
      id="conversation"
      className="conversation-scroll"
      ref={scroll}
      tabIndex={-1}
      aria-label="Conversation history"
      onScroll={(event) => {
        const container = event.currentTarget;
        followLatest.current =
          container.scrollHeight -
            container.scrollTop -
            container.clientHeight <
          96;
      }}
    >
      <div className="transcript-content">
        <h1 className="sr-only">Conversation with {brand.name}</h1>
        {head.isError && head.data && (
          <Alert className="conversation-alert">
            <AlertDescription className="text-inherit">
              Couldn’t refresh your conversation. Your loaded history is still
              shown.
            </AlertDescription>
          </Alert>
        )}
        {head.isPending ? (
          <div className="transcript-state" role="status">
            <span className="loading-mark" aria-hidden="true" />
            <p>Loading your conversation…</p>
          </div>
        ) : head.isError && !head.data ? (
          <div className="transcript-state">
            <h2>Your conversation couldn’t be loaded.</h2>
            <p role="alert">Check your connection and try again.</p>
            <Button
              variant="outline"
              onClick={() => void head.refetch()}
              disabled={head.isFetching}
            >
              {head.isFetching ? 'Loading…' : 'Try again'}
            </Button>
          </div>
        ) : turns.length === 0 ? (
          <div className="transcript-state empty-conversation">
            <BrandLogo size="lg" decorative />
            <h2>No messages yet.</h2>
            <p>Your messages and {brand.name}’s replies will appear here.</p>
          </div>
        ) : (
          <>
            <div className="history-controls">
              {history.olderError ? (
                <>
                  <p role="alert">
                    {stalePage
                      ? 'History changed. Refresh to see the current conversation.'
                      : 'Older messages couldn’t be loaded.'}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      stalePage ? void head.refetch() : retryOlder()
                    }
                    disabled={head.isFetching || history.loadingOlder}
                  >
                    {stalePage
                      ? 'Refresh conversation'
                      : 'Try older messages again'}
                  </Button>
                </>
              ) : history.nextCursor || history.loadingOlder ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="history-button"
                  onClick={loadOlder}
                  disabled={history.loadingOlder}
                >
                  {history.loadingOlder
                    ? 'Loading older messages…'
                    : 'Load older messages'}
                </Button>
              ) : null}
              <span className="sr-only" role="status">
                {history.loadingOlder
                  ? 'Loading older messages.'
                  : `${turns.length} messages and their responses loaded.`}
              </span>
            </div>
            {turns.map((turn) => (
              <ConversationMessage
                key={turn.id}
                turn={turn}
                onRefresh={() => void head.refetch()}
                refreshing={head.isFetching}
                provisional={
                  provisional &&
                  provisional.historyVersion === version &&
                  provisional.turnId === turn.id
                    ? provisional
                    : null
                }
              />
            ))}
          </>
        )}
      </div>
    </main>
  );
}
