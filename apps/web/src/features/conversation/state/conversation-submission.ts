import { ObsoleteSessionError } from '../../auth/session-scope';
import { RequestError } from '../../../lib/api-request';
import type {
  ConversationHistory,
  SubmitInput,
  TurnResult,
} from '../api/conversation-contracts';
import { ConversationApiError } from '../api/conversation-errors';
import { ObsoleteHistoryError } from './conversation-scope';
import type {
  ConversationStreamProgress,
  ProvisionalResponse,
} from '../api/conversation-stream-contracts';

const stoppedStreamMessage =
  'The live response stopped. Checking the saved response…';

interface SubmissionPort {
  assertCurrent(version?: number): void;
  submit(
    input: SubmitInput,
    onProgress: (event: ConversationStreamProgress) => void,
    signal: AbortSignal,
  ): Promise<TurnResult>;
  publish?(result: TurnResult): void;
  refresh(): Promise<ConversationHistory>;
}

export interface SubmissionSnapshot {
  draft: string;
  phase: 'editing' | 'sending' | 'uncertain' | 'checking' | 'stale';
  error: string;
  historyVersion: number | undefined;
  lastAcceptedRequestId: string | null;
  stream: ProvisionalResponse | null;
}

// Owns the draft, delivery identity, and temporary stream text. Saved history stays in Query.
export class ConversationSubmission {
  private snapshot: SubmissionSnapshot = {
    draft: '',
    phase: 'editing',
    error: '',
    historyVersion: undefined,
    lastAcceptedRequestId: null,
    stream: null,
  };
  private pending: SubmitInput | null = null;
  private operation = 0;
  private stopConfirmation: (() => void) | undefined;
  private delivery: AbortController | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly port: SubmissionPort,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<SubmissionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  reset = () => {
    this.stopConfirmation?.();
    this.delivery?.abort();
    this.delivery = undefined;
    this.operation += 1;
    this.pending = null;
    this.update({
      draft: '',
      phase: 'editing',
      error: '',
      lastAcceptedRequestId: null,
      stream: null,
    });
  };

  edit = (draft: string) => {
    if (this.snapshot.phase !== 'editing') return;
    this.update({ draft, error: '' });
  };

  observe = (history: ConversationHistory) => {
    try {
      this.port.assertCurrent(history.historyVersion);
    } catch {
      return;
    }
    const previous = this.snapshot.historyVersion;
    if (previous !== undefined && previous !== history.historyVersion) {
      // Never turn pre-clear text into a fresh submission in the new history.
      this.reset();
      this.update({
        historyVersion: history.historyVersion,
        error: 'History changed. Your previous draft was cleared.',
      });
    } else if (previous === undefined) {
      this.update({ historyVersion: history.historyVersion });
    }
    const input = this.pending;
    const accepted =
      input && history.turns.find((turn) => turn.requestId === input.requestId);
    if (accepted && accepted.text === input.text)
      this.accept(input.requestId, true);
    const stream = this.snapshot.stream;
    const settled = history.turns.some(
      (turn) =>
        turn.requestId === this.snapshot.lastAcceptedRequestId &&
        turn.attempts.length > 0 &&
        turn.attempts.every((attempt) => attempt.state !== 'running'),
    );
    if (settled && this.snapshot.error === stoppedStreamMessage)
      this.update({ error: '' });
    if (
      settled ||
      (stream &&
        history.turns.some((turn) =>
          turn.attempts.some(
            (attempt) =>
              attempt.id === stream.attemptId && attempt.state !== 'running',
          ),
        ))
    ) {
      this.update({ stream: null });
      this.delivery?.abort();
    }
  };

  private accept(requestId: string, preserveDelivery = false) {
    this.stopConfirmation?.();
    if (!preserveDelivery) this.operation += 1;
    this.pending = null;
    this.update({
      draft: '',
      phase: 'editing',
      error: '',
      lastAcceptedRequestId: requestId,
    });
  }

  private current(operation: number) {
    if (this.operation !== operation) return false;
    try {
      this.port.assertCurrent(this.snapshot.historyVersion);
      return true;
    } catch (cause) {
      if (cause instanceof ObsoleteSessionError) {
        this.reset();
      } else if (cause instanceof ObsoleteHistoryError) {
        this.reset();
        this.update({
          phase: 'stale',
          error: 'History changed. Refresh before writing another message.',
        });
      } else {
        throw cause;
      }
      return false;
    }
  }

  send = async (maxMessageBytes: number) => {
    const { draft, phase, historyVersion } = this.snapshot;
    if (
      phase !== 'editing' ||
      historyVersion === undefined ||
      this.snapshot.stream
    )
      return;
    if (!draft.trim()) {
      this.update({ error: 'Write a message first.' });
      return;
    }
    if (new TextEncoder().encode(draft).length > maxMessageBytes) {
      this.update({
        error: `Your message exceeds the ${maxMessageBytes.toLocaleString()} byte limit. Shorten it and try again.`,
      });
      return;
    }
    this.pending = { text: draft, historyVersion, requestId: this.requestId() };
    await this.deliver(false);
  };

  private async deliver(replay: boolean) {
    const input = this.pending;
    if (!input) return;
    const operation = ++this.operation;
    const controller = new AbortController();
    this.delivery?.abort();
    this.delivery = controller;
    let observedProgress = false;
    const onProgress = (event: ConversationStreamProgress) => {
      if (!this.current(operation) || controller.signal.aborted) return;
      observedProgress = true;
      if (event.type === 'accepted') {
        this.port.publish?.(event);
        if (this.pending?.requestId === input.requestId)
          this.accept(input.requestId, true);
        this.update({
          stream:
            !event.replayed && event.attempt.state === 'running'
              ? {
                  historyVersion: event.historyVersion,
                  turnId: event.turn.id,
                  attemptId: event.attempt.id,
                  text: '',
                }
              : null,
        });
      } else {
        const stream = this.snapshot.stream;
        if (!stream || stream.attemptId !== event.attemptId) return;
        // Bound temporary display memory only. The backend still completes and
        // persists the full answer; a detached reader falls back to history.
        if (stream.text.length + event.delta.length > 256 * 1024) {
          controller.abort();
          throw new Error('Provisional display limit reached.');
        }
        this.update({ stream: { ...stream, text: stream.text + event.delta } });
      }
    };
    this.update({ phase: 'sending', error: '' });
    try {
      const result = await this.waitForResult(
        input,
        onProgress,
        controller.signal,
      );
      if (!this.current(operation)) return;
      this.port.assertCurrent(result.historyVersion);
      this.port.publish?.(result);
      this.update({ stream: null });
      if (this.pending?.requestId === input.requestId)
        this.accept(input.requestId);
      // A foreground POST may finish before the next poll. Read canonical history.
      try {
        const history = await this.port.refresh();
        this.observe(history);
      } catch (cause) {
        if (
          cause instanceof ObsoleteSessionError ||
          (cause instanceof RequestError && cause.status === 401)
        ) {
          this.reset();
          return;
        }
        if (
          this.snapshot.lastAcceptedRequestId === input.requestId &&
          this.snapshot.phase === 'editing'
        ) {
          this.update({
            error:
              'Message accepted. Refresh the conversation to see its response.',
          });
        }
      }
    } catch (cause) {
      if (this.operation !== operation) return;
      if (
        cause instanceof ObsoleteSessionError ||
        (cause instanceof RequestError && cause.status === 401)
      ) {
        this.reset();
        return;
      }
      if (
        !this.pending &&
        this.snapshot.lastAcceptedRequestId === input.requestId &&
        !(cause instanceof ObsoleteHistoryError) &&
        !(
          cause instanceof ConversationApiError &&
          cause.code === 'STALE_HISTORY'
        )
      ) {
        this.update({ stream: null });
        // History may have settled the run and deliberately detached this reader.
        if (observedProgress && !controller.signal.aborted)
          this.update({
            error: stoppedStreamMessage,
          });
        await this.refreshHistory();
        return;
      }
      if (
        cause instanceof ObsoleteHistoryError ||
        (cause instanceof ConversationApiError &&
          cause.code === 'STALE_HISTORY')
      ) {
        this.update({ stream: null });
        this.pending = null;
        this.update({
          draft: '',
          phase: 'stale',
          error: 'History changed. Refresh before writing another message.',
        });
        await this.refreshHistory();
        return;
      }
      const rejected =
        cause instanceof ConversationApiError &&
        [
          'BUSY',
          'EXECUTION_UNAVAILABLE',
          'INVALID_INPUT',
          'IDEMPOTENCY_CONFLICT',
        ].includes(cause.code);
      if (
        (cause instanceof ConversationApiError &&
          cause.code === 'IDEMPOTENCY_CONFLICT') ||
        (!replay &&
          (rejected || (cause instanceof RequestError && cause.status === 403)))
      ) {
        this.pending = null;
        this.update({ phase: 'editing', error: cause.message });
        if (cause instanceof ConversationApiError && cause.code === 'BUSY')
          await this.refreshHistory();
        return;
      }
      // A failed transport/response does not prove that admission failed.
      this.update({
        phase: 'uncertain',
        error:
          'Delivery is uncertain. Your message is kept below. Check or resend to continue.',
      });
      await this.refreshHistory();
    } finally {
      if (this.delivery === controller) this.delivery = undefined;
      controller.abort();
    }
  }

  private async waitForResult(
    input: SubmitInput,
    onProgress: (event: ConversationStreamProgress) => void,
    signal: AbortSignal,
  ) {
    let timer: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Delivery confirmation timed out.')),
        15_000,
      );
    });
    const stop = () => clearTimeout(timer);
    this.stopConfirmation = stop;
    // Stop waiting for confirmation without claiming to cancel backend work.
    try {
      return await Promise.race([
        this.port.submit(input, onProgress, signal),
        expired,
      ]);
    } finally {
      stop();
      if (this.stopConfirmation === stop) this.stopConfirmation = undefined;
    }
  }

  private async refreshHistory() {
    try {
      const history = await this.port.refresh();
      this.observe(history);
      return history;
    } catch (cause) {
      if (
        cause instanceof ObsoleteSessionError ||
        (cause instanceof RequestError && cause.status === 401)
      )
        this.reset();
      return undefined;
    }
  }

  reconcile = async () => {
    if (this.snapshot.phase !== 'uncertain' && this.snapshot.phase !== 'stale')
      return;
    const wasStale = this.snapshot.phase === 'stale';
    const operation = ++this.operation;
    this.update({ phase: 'checking', error: '' });
    const history = await this.refreshHistory();
    if (this.operation !== operation) return;
    if (wasStale) {
      this.update({
        phase: 'stale',
        error:
          'History could not be refreshed. Try again before writing another message.',
      });
      return;
    }
    if (!history) {
      this.update({
        phase: 'uncertain',
        error:
          'Delivery could not be checked. Check your connection and try again.',
      });
      return;
    }
    if (!this.current(operation)) return;
    // Only this explicit action may replay a write, using the original payload/key.
    await this.deliver(true);
  };
}
