import { useEffect, useRef } from 'react';
import { ObsoleteSessionError } from '../../auth/session-scope';

export function useMemoryOperation() {
  const lifetime = useRef<AbortController | null>(null);
  const active = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort(new ObsoleteSessionError());
  }, []);
  return {
    signal: () => {
      if (!lifetime.current) throw new ObsoleteSessionError();
      return lifetime.current.signal;
    },
    run: async (operation: () => Promise<unknown>) => {
      // Cover duplicate actions before React publishes the pending state.
      if (active.current) return;
      active.current = true;
      try {
        await operation();
      } catch {
        /* Query owns the visible outcome and explicit recovery state. */
      } finally {
        active.current = false;
      }
    },
  };
}
