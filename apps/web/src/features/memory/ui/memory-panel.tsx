import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { Label } from '../../../components/ui/label';
import { useMemoryChange } from '../state/use-memory-change';
import { memoryCommand } from '../api/memory-contracts';
import type { MemoryEntry } from '../api/memory-contracts';
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
  const [selected, setSelected] = useState<{
    entry: MemoryEntry;
    kind: 'edit' | 'forget';
  } | null>(null);
  const [draft, setDraft] = useState('');
  const change = useMemoryChange(memory, () => {
    setSelected(null);
    setDraft('');
  });
  const locked = change.pending || change.uncertain;
  const valid = memoryCommand(`Remember that ${draft}`)?.error === null;
  const current =
    selected &&
    list.data?.entries.find((entry) => entry.id === selected.entry.id);
  const conflicted =
    !!selected &&
    (change.conflict ||
      (!!current && current.revision !== selected.entry.revision));
  const canReview =
    !!current &&
    current.revision !== selected?.entry.revision &&
    !list.isFetching &&
    !list.isError;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title="Memory"
      showCloseButton
    >
      {selected ? (
        <form
          aria-label={
            selected.kind === 'edit' ? 'Edit memory' : 'Forget memory'
          }
          onSubmit={(event) => {
            event.preventDefault();
            if (
              locked ||
              conflicted ||
              change.forgotten ||
              (selected.kind === 'edit' && !valid)
            )
              return;
            const input = {
              requestId: crypto.randomUUID(),
              expectedRevision: selected.entry.revision,
            };
            void change.start(
              selected.kind === 'edit'
                ? {
                    kind: 'edit',
                    entryId: selected.entry.id,
                    input: {
                      ...input,
                      sourceRequest: `Remember that ${draft}`,
                    },
                  }
                : { kind: 'forget', entryId: selected.entry.id, input },
            );
          }}
        >
          {selected.kind === 'edit' ? (
            <>
              <Label htmlFor="memory-wording">Memory wording</Label>
              <Textarea
                id="memory-wording"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={locked}
                autoFocus
              />
            </>
          ) : (
            <>
              <p>Forget this memory?</p>
              <p className="memory-wording">{selected.entry.text}</p>
            </>
          )}
          {conflicted &&
            current &&
            !list.isError &&
            current.revision !== selected.entry.revision && (
              <p className="memory-wording">Current memory: {current.text}</p>
            )}
          {conflicted && list.isError && (
            <p role="alert">
              The latest memory couldn’t be loaded. Your draft is kept.
            </p>
          )}
          <p>
            This starts fresh conversation context. Your history stays
            available.
          </p>
          {change.notice && <p role="status">{change.notice}</p>}
          <div className="dialog-actions">
            {change.uncertain ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void change.check()}
                >
                  Check change
                </Button>
                <Button type="button" onClick={() => void change.retry()}>
                  Retry change
                </Button>
              </>
            ) : (
              <>
                {selected.kind === 'edit' && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="memory-forget-action"
                    disabled={change.pending || conflicted || change.forgotten}
                    onClick={() => {
                      change.reset();
                      setSelected({ entry: selected.entry, kind: 'forget' });
                    }}
                  >
                    Forget
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={change.pending}
                  onClick={() => {
                    change.reset();
                    setSelected(null);
                  }}
                >
                  Cancel
                </Button>
                {conflicted ? (
                  <Button
                    type="button"
                    disabled={
                      change.pending ||
                      list.isFetching ||
                      (!canReview && !list.isError)
                    }
                    onClick={(event) => {
                      // This action becomes Save after review; suppress its default submission.
                      event.preventDefault();
                      if (list.isError) {
                        void list.refetch();
                        return;
                      }
                      if (!current || !canReview) return;
                      change.reset();
                      setSelected({ entry: current, kind: selected.kind });
                    }}
                  >
                    {list.isError ? 'Try again' : 'Review latest'}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={
                      change.pending ||
                      change.forgotten ||
                      (selected.kind === 'edit' && !valid)
                    }
                  >
                    {selected.kind === 'edit' ? 'Save' : 'Forget'}
                  </Button>
                )}
              </>
            )}
          </div>
        </form>
      ) : list.isPending ? (
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
              <Button
                variant="ghost"
                className="memory-entry-button"
                aria-label={`Edit memory: ${entry.text}`}
                onClick={() => {
                  change.reset();
                  setDraft(entry.text);
                  setSelected({ entry, kind: 'edit' });
                }}
              >
                <span className="memory-wording">{entry.text}</span>
                <Pencil aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
