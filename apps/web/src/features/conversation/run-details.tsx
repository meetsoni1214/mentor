import type { ConversationHistory } from './conversation-contracts';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

type Attempt = ConversationHistory['turns'][number]['attempts'][number];

export const attemptLabels: Record<Attempt['state'], string> = {
  running: 'Working',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

export function MessageTime({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <time dateTime={value} title={date.toLocaleString()}>
      {date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })}
    </time>
  );
}

export function RunDetails({ attempts }: { attempts: Attempt[] }) {
  if (attempts.length === 0) return null;
  return (
    <Collapsible className="run-details">
      <CollapsibleTrigger className="run-details-trigger">
        Run details
        <ChevronDown aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="run-details-content">
        {[...attempts]
          .sort((a, b) => a.attemptNumber - b.attemptNumber)
          .map((attempt) => (
            <section
              key={attempt.id}
              aria-label={`Attempt ${attempt.attemptNumber}`}
            >
              <h3>
                Attempt {attempt.attemptNumber}
                <span>{attemptLabels[attempt.state]}</span>
              </h3>
              <dl>
                <dt>Model</dt>
                <dd>{attempt.model}</dd>
                <dt>Started</dt>
                <dd>
                  <MessageTime value={attempt.startedAt} />
                </dd>
                <dt>Finished</dt>
                <dd>
                  {attempt.finishedAt ? (
                    <MessageTime value={attempt.finishedAt} />
                  ) : (
                    'Not finished'
                  )}
                </dd>
                <dt>Input tokens</dt>
                <dd>{attempt.inputTokens ?? 'Not reported'}</dd>
                <dt>Output tokens</dt>
                <dd>{attempt.outputTokens ?? 'Not reported'}</dd>
                <dt>Context</dt>
                <dd>
                  {attempt.contextLimited
                    ? 'Older messages were omitted'
                    : 'Within the context limit'}
                </dd>
                {attempt.errorCode && (
                  <>
                    <dt>Outcome</dt>
                    <dd>{attempt.errorCode}</dd>
                  </>
                )}
              </dl>
              {attempt.activity.length > 0 ? (
                <ul className="run-activity">
                  {attempt.activity.map((activity, index) => (
                    <li key={index}>Web search · {activity.status}</li>
                  ))}
                </ul>
              ) : (
                <p className="run-note">No web activity recorded.</p>
              )}
              {attempt.sources.length > 0 && (
                <ul className="run-sources" aria-label="Recorded sources">
                  {attempt.sources.map((source, index) => (
                    <li key={index}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        <p className="run-note">
          Token counts are reported by the SDK and may be unavailable.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
