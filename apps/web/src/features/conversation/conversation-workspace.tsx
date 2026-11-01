import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionScope } from '../auth/session-scope';
import { ConversationComposer } from './conversation-composer';
import { createConversationQueries } from './conversation-queries';
import { ConversationTranscript } from './conversation-transcript';
import { useConversationHistory } from './use-conversation-history';
import { BrandLockup } from '../../brand/brand-logo';

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
  const history = useConversationHistory(conversation);
  const status = useQuery(conversation.statusOptions());

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
      <ConversationTranscript history={history} />
      <ConversationComposer />
    </div>
  );
}
