import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/ui/button';
import { Dialog } from '../../../components/ui/dialog';
import type { createMemoryQueries } from '../state/memory-queries';
import type { MemorySaveState } from '../state/memory-save';

export function MemorySaveNotice({
  state,
  onCheck,
  onRetry,
}: {
  state: MemorySaveState;
  onCheck: () => void;
  onRetry: () => void;
}) {
  if (!state.notice) return null;
  return (
    <div className="workspace-notice memory-save-notice">
      <p role="status">{state.notice}</p>
      {state.phase === 'uncertain' && state.pending && (
        <p className="memory-wording">{state.pending.input.sourceRequest}</p>
      )}
      {state.phase === 'uncertain' && (
        <div className="dialog-actions">
          <Button variant="outline" size="sm" onClick={onCheck}>
            Check saved request
          </Button>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry original save
          </Button>
        </div>
      )}
    </div>
  );
}

export function MemoryPanel({
  open,
  onClose,
  memory,
}: {
  open: boolean;
  onClose: () => void;
  memory: ReturnType<typeof createMemoryQueries>;
}) {
  const list = useQuery({ ...memory.listOptions(), enabled: open });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title="Memory"
    >
      {list.isPending ? (
        <p role="status">Loading memories…</p>
      ) : list.isError ? (
        <>
          <p role="alert">Memories couldn’t be loaded.</p>
          <Button
            variant="outline"
            disabled={list.isFetching}
            onClick={() => void list.refetch()}
          >
            Try again
          </Button>
        </>
      ) : list.data.entries.length === 0 ? (
        <p>
          No saved memories yet. To add one, start a message with “Remember that
          …”.
        </p>
      ) : (
        <ul className="memory-list">
          {list.data.entries.map((entry) => (
            <li key={entry.id}>
              <p className="memory-wording">{entry.text}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <Button onClick={onClose}>Close Memory</Button>
      </div>
    </Dialog>
  );
}
