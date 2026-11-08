import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { ArrowUp, RotateCcw } from 'lucide-react';
import { brand } from '../../../brand/brand';
import type { SubmissionSnapshot } from '../state/conversation-submission';

export function ConversationComposer({
  state,
  onDraftChange,
  onSend,
  onReconcile,
  blockedReason,
  disabled,
}: {
  state: SubmissionSnapshot;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onReconcile: () => void;
  blockedReason: string | null;
  disabled: boolean;
}) {
  const recovering = state.phase === 'uncertain' || state.phase === 'stale';
  const pending = state.phase === 'sending' || state.phase === 'checking';
  const unavailable =
    disabled ||
    pending ||
    (!recovering && (!!blockedReason || !state.draft.trim()));
  const label =
    state.phase === 'stale'
      ? 'Refresh conversation'
      : recovering
        ? 'Check or resend message'
        : 'Send message';
  const hint =
    state.phase === 'sending'
      ? 'Sending…'
      : state.phase === 'checking'
        ? 'Checking delivery…'
        : state.phase === 'stale'
          ? 'Refresh your conversation before writing another message.'
          : recovering
            ? 'Confirm delivery before writing another message.'
            : (blockedReason ?? 'Enter to send · Shift + Enter for a new line');
  return (
    <footer className="composer-region">
      <div className="composer-content">
        {state.error && (
          <Alert className="composer-error" id="composer-error">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <form
          className="composer-box"
          aria-label="Message composer"
          aria-describedby="composer-availability"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (!unavailable) (recovering ? onReconcile : onSend)();
          }}
        >
          <Label htmlFor="conversation-message" className="sr-only">
            Message {brand.name}
          </Label>
          <Textarea
            className="min-h-11 resize-none rounded-none border-0 p-0 shadow-none focus-visible:ring-0 disabled:opacity-100"
            id="conversation-message"
            placeholder={`Message ${brand.name}…`}
            rows={2}
            value={state.draft}
            onChange={(event) => onDraftChange(event.target.value)}
            disabled={disabled}
            readOnly={state.phase !== 'editing'}
            aria-describedby={
              state.error
                ? 'composer-availability composer-error'
                : 'composer-availability'
            }
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-actions">
            <p id="composer-availability" role="status">
              {hint}
            </p>
            <Button
              size="icon"
              type="submit"
              disabled={unavailable}
              aria-label={label}
            >
              {recovering ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <ArrowUp aria-hidden="true" />
              )}
            </Button>
          </div>
        </form>
      </div>
    </footer>
  );
}
