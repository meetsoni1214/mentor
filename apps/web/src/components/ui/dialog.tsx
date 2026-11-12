'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

// The native modal supplies focus containment, Escape, and an inert background.
export function Dialog({
  open,
  onOpenChange,
  title,
  showCloseButton = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  showCloseButton?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="app-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
    >
      {showCloseButton ? (
        <div className="app-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <h2 id={titleId}>{title}</h2>
      )}
      {children}
    </dialog>
  );
}
