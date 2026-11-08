import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionScope } from '../auth/session-scope';
import { ConversationComposer } from './ui/conversation-composer';
import { createConversationQueries } from './state/conversation-queries';
import { ConversationTranscript } from './ui/conversation-transcript';
import { useConversationHistory } from './state/use-conversation-history';
import { BrandLockup } from '../../brand/brand-logo';
import { useConversationSubmission } from './state/use-conversation-submission';
import { retryableTurnId } from './state/submission-state';
import { hasRunningAttempt } from './state/conversation-polling';

export function ConversationWorkspace({
  session,
  onSignOut,
  signingOut,
  signOutError,
}: {
  session: SessionScope;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: string;
}) {
  const queryClient = useQueryClient();
  // AuthScreen keys this workspace by session generation, so the adapter is shared
  // across renders and is replaced together with all local UI state after sign-in.
  const [conversation] = useState(() =>
    createConversationQueries(session, queryClient),
  );
  const { submission, state } = useConversationSubmission(conversation);
  const deliveryPending = ['sending', 'checking', 'uncertain'].includes(
    state.phase,
  );
  const history = useConversationHistory(
    conversation,
    deliveryPending,
    state.stream?.attemptId,
  );
  const status = useQuery(conversation.statusOptions());
  useEffect(() => {
    if (history.head.data) submission.observe(history.head.data);
  }, [submission, history.head.data]);
  const blockedReason = signingOut
    ? 'Signing out…'
    : !history.head.data
      ? 'Load your conversation before sending.'
      : history.head.isError
        ? 'Refresh your conversation before sending.'
        : status.isPending
          ? 'Checking assistant availability…'
          : status.isError
            ? 'Check assistant availability before sending.'
            : !status.data.enabled
              ? 'Assistant responses are unavailable. Your draft stays here.'
              : state.stream || hasRunningAttempt(history.head.data)
                ? 'Working… You can write your next message while you wait.'
                : null;

  return (
    <div className="conversation-workspace">
      <a className="skip-link" href="#conversation">
        Skip to conversation
      </a>
      <header className="workspace-header">
        <BrandLockup />
        <Button
          variant="outline"
          size="sm"
          onClick={onSignOut}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </header>
      <div className="conversation-toolbar">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void history.head.refetch()}
          disabled={history.head.isFetching}
        >
          {history.head.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {signOutError && (
        <Alert className="workspace-notice">
          <AlertDescription className="text-inherit">
            {signOutError}
          </AlertDescription>
        </Alert>
      )}
      {status.isPending ? (
        <Alert className="workspace-notice" role="status">
          <AlertDescription className="text-inherit">
            Checking assistant availability…
          </AlertDescription>
        </Alert>
      ) : status.isError ? (
        <Alert className="workspace-notice">
          <AlertDescription className="text-inherit">
            Assistant availability couldn’t be checked.{' '}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void status.refetch()}
              disabled={status.isFetching}
            >
              {status.isFetching ? 'Checking…' : 'Try again'}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !status.data.enabled ? (
        <Alert className="workspace-notice" role="status">
          <AlertDescription className="text-inherit">
            Assistant responses are unavailable. You can still read your
            conversation.
          </AlertDescription>
        </Alert>
      ) : null}
      <ConversationTranscript
        history={history}
        acceptedRequestId={state.lastAcceptedRequestId}
        provisional={state.stream}
        retryTurnId={retryableTurnId(history.head.data)}
        pendingRetryTurnId={state.pendingRetryTurnId}
        retryDisabled={!!blockedReason || state.phase !== 'editing'}
        onRetry={(turnId) => {
          if (!blockedReason && state.phase === 'editing' && history.head.data)
            void submission.retry(turnId, history.head.data);
        }}
      />
      <ConversationComposer
        state={state}
        onDraftChange={submission.edit}
        onSend={() => {
          if (!blockedReason && status.data?.limits)
            void submission.send(status.data.limits.maxMessageBytes);
        }}
        onReconcile={() => void submission.reconcile()}
        blockedReason={blockedReason}
        disabled={signingOut || state.historyVersion === undefined}
      />
    </div>
  );
}
