import { useEffect, useRef } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog } from '../../../components/ui/dialog';
import { clearNoticeText } from '../state/submission-state';
import type { HistoryClearState } from '../state/submission-state';

export function HistoryClearNotice({
  state,
  onCheck,
  onRetry,
}: {
  state: HistoryClearState;
  onCheck: () => void;
  onRetry: () => void;
}) {
  const text = clearNoticeText(state);
  if (!text) return null;
  return (
    <div className="history-clear-notice">
      <p role="status">{text}</p>
      {(state.phase === 'uncertain' || state.phase === 'refresh-failed') && (
        <div className="dialog-actions">
          <Button variant="outline" size="sm" onClick={onCheck}>
            Check history
          </Button>
          {state.phase === 'uncertain' && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry original clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function ClearHistoryDialog({
  version,
  currentVersion,
  disabled,
  onClose,
  onConfirm,
}: {
  version: number | null;
  currentVersion: number | undefined;
  disabled: boolean;
  onClose: () => void;
  onConfirm: (version: number) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (version !== null) cancel.current?.focus();
  }, [version]);
  const changed = version !== null && version !== currentVersion;
  return (
    <Dialog
      open={version !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Clear conversation history?"
    >
      <p>
        This permanently removes all saved messages, response attempts, and
        sources, plus your current draft. This cannot be undone.
      </p>
      <p>Clearing cannot retract content already sent to the model provider.</p>
      {changed && (
        <p role="status">
          History changed. Cancel and review the current conversation before
          clearing.
        </p>
      )}
      <div className="dialog-actions">
        <Button ref={cancel} variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={disabled || changed || version === null}
          onClick={() => {
            if (!disabled && !changed && version !== null) onConfirm(version);
          }}
        >
          Clear history
        </Button>
      </div>
    </Dialog>
  );
}
