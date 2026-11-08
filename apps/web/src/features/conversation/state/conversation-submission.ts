import type {
  ConversationHistory,
  SubmitInput,
  RetryInput,
  TurnResult,
  ClearInput,
} from '../api/conversation-contracts';
import type { ConversationStreamProgress } from '../api/conversation-stream-contracts';
import * as state from './submission-state';

export type { SubmissionSnapshot } from './submission-state';

interface SubmissionPort {
  assertCurrent(version?: number): void;
  submit(
    input: SubmitInput,
    onProgress: (event: ConversationStreamProgress) => void,
    signal: AbortSignal,
  ): Promise<TurnResult>;
  retry(
    turnId: string,
    input: RetryInput,
    onProgress: (event: ConversationStreamProgress) => void,
    signal: AbortSignal,
  ): Promise<TurnResult>;
  publish?(result: TurnResult): void;
  clear(
    input: ClearInput,
    signal: AbortSignal,
  ): Promise<{ historyVersion: number }>;
  refresh(): Promise<ConversationHistory>;
}

type DeliveryMode = 'initial-delivery' | 'explicit-resend';

// Coordinates effects. Draft/delivery transitions live in submission-state;
// committed history stays in Query and PostgreSQL.
export class ConversationSubmission {
  private state = state.initialState();
  private snapshot = state.projectSnapshot(this.state);
  private deliveryGeneration = 0;
  private stopConfirmation: (() => void) | undefined;
  private deliveryController: AbortController | undefined;
  private clearController: AbortController | undefined;
  private clearGeneration = 0;
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

  private transition(next: state.SubmissionState) {
    if (next === this.state) return;
    this.state = next;
    this.snapshot = state.projectSnapshot(next);
    for (const listener of this.listeners) listener();
  }

  private invalidateDelivery() {
    this.stopConfirmation?.();
    this.deliveryController?.abort();
    this.deliveryController = undefined;
    this.deliveryGeneration += 1;
  }

  reset = () => {
    this.invalidateDelivery();
    this.invalidateClear();
    this.transition(state.initialState(this.state.historyVersion));
  };

  edit = (draft: string) => {
    this.transition(state.editDraft(this.state, draft));
  };

  observe = (history: ConversationHistory) => {
    try {
      this.port.assertCurrent(history.historyVersion);
    } catch {
      return;
    }
    const observed = state.observeHistory(this.state, history);
    if (observed.historyChanged) {
      this.invalidateDelivery();
      this.invalidateClear();
    }
    if (observed.accepted) this.stopConfirmation?.();
    this.transition(observed.state);
    if (observed.settled) this.deliveryController?.abort();
  };

  private current(generation: number) {
    if (this.deliveryGeneration !== generation) return false;
    try {
      this.port.assertCurrent(this.state.historyVersion);
      return true;
    } catch (cause) {
      const failure = state.classifyFailure(cause);
      if (failure.kind === 'session-lost') this.reset();
      else if (failure.kind === 'history-changed') {
        this.reset();
        this.transition(state.invalidateHistory(this.state));
      } else throw cause;
      return false;
    }
  }

  send = async (maxMessageBytes: number) => {
    const { draft, delivery, historyVersion, stream } = this.state;
    if (
      this.state.historyClear.phase !== 'idle' ||
      delivery.phase !== 'editing' ||
      historyVersion === undefined ||
      stream
    )
      return;
    const notice = state.validateDraft(draft, maxMessageBytes);
    if (notice) {
      this.transition(state.reportNotice(this.state, notice));
      return;
    }
    const input = { text: draft, historyVersion, requestId: this.requestId() };
    await this.deliver({ kind: 'send', input }, 'initial-delivery');
  };

  retry = async (turnId: string, history: ConversationHistory) => {
    if (
      this.state.historyClear.phase !== 'idle' ||
      this.state.delivery.phase !== 'editing' ||
      this.state.stream ||
      this.state.historyVersion !== history.historyVersion ||
      state.retryableTurnId(history) !== turnId ||
      !this.current(this.deliveryGeneration)
    )
      return;
    await this.deliver(
      {
        kind: 'retry',
        turnId,
        input: {
          historyVersion: history.historyVersion,
          requestId: this.requestId(),
        },
      },
      'initial-delivery',
    );
  };

  private async deliver(
    operation: state.DeliveryOperation,
    mode: DeliveryMode,
  ) {
    const { input } = operation;
    const generation = ++this.deliveryGeneration;
    const controller = new AbortController();
    this.deliveryController?.abort();
    this.deliveryController = controller;
    let observedProgress = false;
    const onProgress = (event: ConversationStreamProgress) => {
      if (!this.current(generation) || controller.signal.aborted) return;
      observedProgress = true;
      if (event.type === 'accepted') {
        this.port.publish?.(event);
        if (
          state.unresolvedOperation(this.state)?.input.requestId ===
          input.requestId
        )
          this.stopConfirmation?.();
        this.transition(state.receiveAcceptance(this.state, event));
      } else {
        const stream = this.state.stream;
        if (!stream || stream.attemptId !== event.attemptId) return;
        // Bound temporary display memory; backend execution/persistence continues.
        if (stream.text.length + event.delta.length > 256 * 1024) {
          controller.abort();
          throw new Error('Provisional display limit reached.');
        }
        this.transition(state.appendText(this.state, event.delta));
      }
    };
    this.transition(state.beginDelivery(this.state, operation));
    try {
      const result = await this.waitForResult(
        operation,
        onProgress,
        controller.signal,
      );
      if (!this.current(generation)) return;
      this.port.assertCurrent(result.historyVersion);
      this.port.publish?.(result);
      this.transition(state.finishResponse(this.state));
      if (
        state.unresolvedOperation(this.state)?.input.requestId ===
        input.requestId
      ) {
        this.stopConfirmation?.();
        this.deliveryGeneration += 1;
        this.transition(state.confirmAcceptance(this.state, input.requestId));
      }
      // A final POST snapshot may precede the next poll. Read canonical history.
      const history = await this.refreshHistory();
      if (
        !history &&
        this.state.lastAcceptedRequestId === input.requestId &&
        this.state.delivery.phase === 'editing'
      )
        this.transition(
          state.reportNotice(this.state, {
            code: 'accepted-refresh-failed',
            operation: operation.kind,
          }),
        );
    } catch (cause) {
      if (this.deliveryGeneration !== generation) return;
      const failure = state.classifyFailure(cause);
      if (failure.kind === 'session-lost') {
        this.reset();
        return;
      }
      if (failure.kind === 'history-changed') {
        this.transition(state.invalidateHistory(this.state));
        await this.refreshHistory();
        return;
      }
      const accepted =
        !state.unresolvedOperation(this.state) &&
        this.state.lastAcceptedRequestId === input.requestId;
      if (accepted) {
        // Saved history may have deliberately detached this reader already.
        const notice =
          observedProgress && !controller.signal.aborted ? 'stream-lost' : null;
        this.transition(state.loseStream(this.state, notice));
        await this.refreshHistory();
        return;
      }
      if (
        failure.kind === 'rejected' &&
        (failure.reason === 'IDEMPOTENCY_CONFLICT' ||
          mode === 'initial-delivery')
      ) {
        this.transition(state.rejectDelivery(this.state, failure.reason));
        if (['BUSY', 'NOT_FOUND', 'NOT_RETRYABLE'].includes(failure.reason))
          await this.refreshHistory();
        return;
      }
      // A later rejected resend cannot prove the original admission failed.
      this.transition(state.markUncertain(this.state));
      await this.refreshHistory();
    } finally {
      if (this.deliveryController === controller)
        this.deliveryController = undefined;
      controller.abort();
    }
  }

  private async waitForResult(
    operation: state.DeliveryOperation,
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
    // Acceptance stops this wait without cancelling admitted backend work.
    try {
      return await Promise.race([
        operation.kind === 'send'
          ? this.port.submit(operation.input, onProgress, signal)
          : this.port.retry(
              operation.turnId,
              operation.input,
              onProgress,
              signal,
            ),
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
      if (state.classifyFailure(cause).kind === 'session-lost') this.reset();
      return undefined;
    }
  }

  reconcile = async () => {
    if (this.state.historyClear.phase !== 'idle') return;
    const phase = this.state.delivery.phase;
    if (phase !== 'uncertain' && phase !== 'stale') return;
    const generation = ++this.deliveryGeneration;
    this.transition(state.beginCheck(this.state));
    const history = await this.refreshHistory();
    if (this.deliveryGeneration !== generation) return;
    if (this.state.delivery.phase === 'refreshing-history' || !history) {
      this.transition(state.failHistoryCheck(this.state));
      return;
    }
    if (!this.current(generation)) return;
    if (this.state.historyClear.phase !== 'idle') {
      this.transition(state.markUncertain(this.state));
      return;
    }
    const operation = state.unresolvedOperation(this.state);
    // Only this explicit action may replay a write, with its original payload/key.
    if (operation) await this.deliver(operation, 'explicit-resend');
  };

  private invalidateClear() {
    this.clearGeneration += 1;
    this.clearController?.abort();
    this.clearController = undefined;
  }

  private clearIsCurrent(generation: number) {
    if (generation !== this.clearGeneration) return false;
    try {
      this.port.assertCurrent();
      return true;
    } catch (cause) {
      if (state.classifyFailure(cause).kind === 'session-lost') this.reset();
      return false;
    }
  }

  clear = async (historyVersion: number) => {
    if (
      this.state.historyClear.phase !== 'idle' ||
      this.state.historyVersion !== historyVersion
    )
      return;
    await this.executeClear({ historyVersion }, 'initial-delivery');
  };

  retryClear = async () => {
    const clear = this.state.historyClear;
    if (clear.phase !== 'uncertain') return;
    await this.executeClear(clear.input, 'explicit-resend');
  };

  private async executeClear(input: ClearInput, mode: DeliveryMode) {
    const generation = ++this.clearGeneration;
    if (!this.clearIsCurrent(generation)) return;
    const controller = new AbortController();
    this.clearController = controller;
    this.transition(state.beginClear(this.state, input));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Losing the response or aborting delivery never proves deletion rolled back.
      const result = await Promise.race([
        this.port.clear(input, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Clear confirmation timed out.')),
            15_000,
          );
        }),
      ]);
      if (!this.clearIsCurrent(generation)) return;
      this.port.assertCurrent(result.historyVersion);
      this.invalidateDelivery();
      this.transition(state.confirmClear(this.state, result.historyVersion));
      await this.loadAfterClear(generation);
    } catch (cause) {
      if (!this.clearIsCurrent(generation)) return;
      const failure = state.classifyFailure(cause);
      if (failure.kind === 'session-lost') {
        this.reset();
      } else if (failure.kind === 'history-changed') {
        this.invalidateDelivery();
        this.transition(state.confirmClear(this.state));
        await this.loadAfterClear(generation, 'changed');
      } else if (failure.kind === 'rejected' && mode === 'initial-delivery') {
        this.transition({
          ...this.state,
          historyClear: { phase: 'idle', notice: 'rejected' },
        });
      } else {
        this.transition({
          ...this.state,
          historyClear: { phase: 'uncertain', input, checkFailed: false },
        });
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (this.clearController === controller) this.clearController = undefined;
    }
  }

  private async loadAfterClear(
    generation: number,
    notice: 'cleared' | 'changed' = 'cleared',
  ) {
    try {
      const history = await this.port.refresh();
      if (!this.clearIsCurrent(generation)) return;
      this.port.assertCurrent(history.historyVersion);
      this.observe(history);
      // observe may itself settle a newer-version history and invalidate this work.
      if (!this.clearIsCurrent(generation)) return;
      this.transition({
        ...this.state,
        historyClear: { phase: 'idle', notice },
      });
    } catch (cause) {
      if (!this.clearIsCurrent(generation)) return;
      if (state.classifyFailure(cause).kind === 'session-lost') this.reset();
      else
        this.transition({
          ...this.state,
          historyClear: { phase: 'refresh-failed' },
        });
    }
  }

  checkClear = async () => {
    const clear = this.state.historyClear;
    if (clear.phase !== 'uncertain' && clear.phase !== 'refresh-failed') return;
    const generation = ++this.clearGeneration;
    if (!this.clearIsCurrent(generation)) return;
    if (clear.phase === 'refresh-failed') {
      this.transition({ ...this.state, historyClear: { phase: 'refreshing' } });
      await this.loadAfterClear(generation, 'changed');
      return;
    }
    if (clear.phase !== 'uncertain') return;
    this.transition({
      ...this.state,
      historyClear: { ...clear, phase: 'checking' },
    });
    try {
      const history = await this.port.refresh();
      if (!this.clearIsCurrent(generation)) return;
      this.observe(history);
      if (!this.clearIsCurrent(generation)) return;
      // An old-version read can finish before a previously admitted DELETE.
      this.transition({
        ...this.state,
        historyClear: { ...clear, checkFailed: false },
      });
    } catch (cause) {
      if (!this.clearIsCurrent(generation)) return;
      if (state.classifyFailure(cause).kind === 'session-lost') this.reset();
      else
        this.transition({
          ...this.state,
          historyClear: { ...clear, checkFailed: true },
        });
    }
  };
}
