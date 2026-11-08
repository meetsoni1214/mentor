import type {
  ConversationHistory,
  SubmitInput,
  TurnResult,
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
  publish?(result: TurnResult): void;
  refresh(): Promise<ConversationHistory>;
}

type DeliveryMode = 'initial-send' | 'explicit-resend';

// Coordinates effects. Draft/delivery transitions live in submission-state;
// committed history stays in Query and PostgreSQL.
export class ConversationSubmission {
  private state = state.initialState();
  private snapshot = state.projectSnapshot(this.state);
  private deliveryGeneration = 0;
  private stopConfirmation: (() => void) | undefined;
  private deliveryController: AbortController | undefined;
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
    if (observed.historyChanged) this.invalidateDelivery();
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
    if (delivery.phase !== 'editing' || historyVersion === undefined || stream)
      return;
    const notice = state.validateDraft(draft, maxMessageBytes);
    if (notice) {
      this.transition(state.reportNotice(this.state, notice));
      return;
    }
    const input = { text: draft, historyVersion, requestId: this.requestId() };
    await this.deliver(input, 'initial-send');
  };

  private async deliver(input: Readonly<SubmitInput>, mode: DeliveryMode) {
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
        if (state.unresolvedInput(this.state)?.requestId === input.requestId)
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
    this.transition(state.beginDelivery(this.state, input));
    try {
      const result = await this.waitForResult(
        input,
        onProgress,
        controller.signal,
      );
      if (!this.current(generation)) return;
      this.port.assertCurrent(result.historyVersion);
      this.port.publish?.(result);
      this.transition(state.finishResponse(this.state));
      if (state.unresolvedInput(this.state)?.requestId === input.requestId) {
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
          state.reportNotice(this.state, { code: 'accepted-refresh-failed' }),
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
        !state.unresolvedInput(this.state) &&
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
        (failure.reason === 'IDEMPOTENCY_CONFLICT' || mode === 'initial-send')
      ) {
        this.transition(state.rejectDelivery(this.state, failure.reason));
        if (failure.reason === 'BUSY') await this.refreshHistory();
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
    input: Readonly<SubmitInput>,
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
      if (state.classifyFailure(cause).kind === 'session-lost') this.reset();
      return undefined;
    }
  }

  reconcile = async () => {
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
    const input = state.unresolvedInput(this.state);
    // Only this explicit action may replay a write, with its original payload/key.
    if (input) await this.deliver(input, 'explicit-resend');
  };
}
