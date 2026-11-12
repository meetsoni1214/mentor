import { Button } from '../../../components/ui/button';
import type { ConversationHistory } from '../api/conversation-contracts';
import { MessageTime, RunDetails } from './run-details';
import { brand } from '../../../brand/brand';
import type { ProvisionalResponse } from '../api/conversation-stream-contracts';
import { AssistantContent } from './content/assistant-content';

type Turn = ConversationHistory['turns'][number];
type Attempt = Turn['attempts'][number];

const failureMessages: Record<NonNullable<Attempt['errorCode']>, string> = {
  PROVIDER_ERROR: `${brand.name} could not complete this response.`,
  REFUSED: `${brand.name} could not answer this request.`,
  INCOMPLETE: 'This response could not be completed.',
  INVALID_RESPONSE: `${brand.name} could not produce a valid response.`,
  RATE_LIMITED: 'The model was temporarily rate limited.',
  LIMIT_EXCEEDED: 'This response reached an execution limit.',
  INTERRUPTED: 'This response was interrupted before it finished.',
};

export function ConversationMessage({
  turn,
  onRefresh,
  refreshing,
  provisional,
  onRetry,
  retryDisabled = false,
  retrying = false,
}: {
  turn: Turn;
  onRefresh: () => void;
  refreshing: boolean;
  provisional: ProvisionalResponse | null;
  onRetry?: (() => void) | undefined;
  retryDisabled?: boolean;
  retrying?: boolean;
}) {
  const latest = turn.attempts.reduce<Attempt | undefined>(
    (current, attempt) =>
      !current || attempt.attemptNumber > current.attemptNumber
        ? attempt
        : current,
    undefined,
  );

  return (
    <article
      className="conversation-turn"
      data-turn={turn.id}
      aria-label={`Message ${turn.sequence}`}
      tabIndex={-1}
    >
      <div className="message message-user">
        <div className="message-meta">
          <MessageTime value={turn.createdAt} />
        </div>
        <div className="message-bubble" tabIndex={0}>
          {turn.text}
        </div>
      </div>
      <div className="message message-assistant">
        <div className="message-meta">
          {latest && (
            <MessageTime value={latest.finishedAt ?? latest.startedAt} />
          )}
        </div>
        <div
          className={`message-bubble${latest?.state === 'completed' ? '' : ' message-outcome'}`}
          tabIndex={0}
        >
          {latest?.state === 'completed' ? (
            <AssistantContent
              text={latest.answer ?? ''}
              sources={latest.sources}
            />
          ) : latest?.state === 'running' ? (
            <>
              {provisional?.attemptId === latest.id && provisional.text ? (
                <div className="provisional-answer">
                  <AssistantContent text={provisional.text} />
                </div>
              ) : null}
              <p role="status">
                <span className="working-dot" aria-hidden="true" />
                {provisional?.attemptId === latest.id
                  ? 'Responding…'
                  : 'Working…'}
              </p>
              {provisional?.attemptId !== latest.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="outcome-action"
                  onClick={onRefresh}
                  disabled={refreshing}
                >
                  {refreshing ? 'Checking…' : 'Check for updates'}
                </Button>
              )}
            </>
          ) : (
            <>
              <p>
                {latest?.errorCode
                  ? failureMessages[latest.errorCode]
                  : 'No response is available for this message.'}
              </p>
              {onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="outcome-action"
                  onClick={onRetry}
                  disabled={retryDisabled}
                >
                  {retrying ? 'Retrying…' : 'Retry response'}
                </Button>
              )}
            </>
          )}
        </div>
        {latest?.contextLimited && (
          <p className="context-note">
            Some older messages were outside this response’s context.
          </p>
        )}
        {latest?.state === 'completed' &&
          latest.activity.length > 0 &&
          latest.sources.length === 0 && (
            <p className="context-note">
              No usable source references were recorded for this response.
            </p>
          )}
        <RunDetails attempts={turn.attempts} />
      </div>
    </article>
  );
}
