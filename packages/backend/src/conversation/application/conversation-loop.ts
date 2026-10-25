import { ConversationError } from '../domain/conversation.js';
import type {
  Admission,
  AttemptReference,
  RetryRequest,
  RunLimits,
  Submission,
} from './conversation.contracts.js';
import type { ConversationModel } from './ports/conversation.model.js';
import type { ConversationRepository } from './ports/conversation.repository.js';
import type { RunOutcome } from '../domain/conversation.js';
import { contextByteLength, selectContext } from './select-context.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type ConversationExecution =
  | { enabled: false }
  | { enabled: true; model: ConversationModel; limits: RunLimits };

export class ConversationLoop {
  private readonly active = new Map<
    string,
    { historyVersion: number; controller: AbortController }
  >();

  constructor(
    private readonly repository: ConversationRepository,
    private readonly execution: ConversationExecution,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!execution.enabled) return;
    const { limits } = execution;
    if (
      !limits.model.trim() ||
      ![
        limits.maxMessageBytes,
        limits.maxContextBytes,
        limits.maxOutputTokens,
        limits.maxToolCalls,
        limits.maxModelCalls,
        limits.deadlineMs,
      ].every((value) => Number.isSafeInteger(value) && value > 0) ||
      !limits.allowedTools.every((tool) => tool === 'web_search') ||
      limits.deadlineMs > 300_000 ||
      limits.maxContextBytes < limits.maxMessageBytes
    ) {
      throw new ConversationError('INVALID_INPUT');
    }
  }

  private validate(
    ownerId: string,
    historyVersion: number,
    requestId?: string,
  ): void {
    if (
      !uuid.test(ownerId) ||
      (requestId !== undefined && !uuid.test(requestId)) ||
      !Number.isSafeInteger(historyVersion) ||
      historyVersion < 0
    )
      throw new ConversationError('INVALID_INPUT');
  }

  async submit(input: Submission): Promise<Admission> {
    this.validate(input.ownerId, input.historyVersion, input.requestId);
    const execution = this.requireExecution();
    const { limits } = execution;
    if (
      !input.text.trim() ||
      new TextEncoder().encode(input.text).length > limits.maxMessageBytes ||
      contextByteLength([{ role: 'user', text: input.text }]) >
        limits.maxContextBytes
    ) {
      throw new ConversationError('INVALID_INPUT');
    }
    const admission = await this.repository.submit(input, limits);
    return this.execute(input.ownerId, admission, execution);
  }

  async retry(input: RetryRequest): Promise<Admission> {
    this.validate(input.ownerId, input.historyVersion, input.requestId);
    if (!uuid.test(input.turnId)) throw new ConversationError('INVALID_INPUT');
    const execution = this.requireExecution();
    const admission = await this.repository.retry(input, execution.limits);
    return this.execute(input.ownerId, admission, execution);
  }

  history(
    ownerId: string,
    options?: Parameters<ConversationRepository['history']>[1],
  ) {
    this.validate(ownerId, options?.cursor?.historyVersion ?? 0);
    return this.repository.history(ownerId, options);
  }

  async clear(ownerId: string, historyVersion: number): Promise<number> {
    this.validate(ownerId, historyVersion);
    const active = this.active.get(ownerId);
    const version = await this.repository.clear(ownerId, historyVersion);
    // Capture before clearing: a new-version run may already have started.
    if (active?.historyVersion === historyVersion) active.controller.abort();
    return version;
  }

  private requireExecution(): Extract<
    ConversationExecution,
    { enabled: true }
  > {
    if (!this.execution.enabled)
      throw new ConversationError('EXECUTION_UNAVAILABLE');
    return this.execution;
  }

  private async execute(
    ownerId: string,
    admission: Admission,
    execution: Extract<ConversationExecution, { enabled: true }>,
  ): Promise<Admission> {
    if (!admission.execute) return admission;
    const { model, limits } = execution;
    const ref: AttemptReference = {
      ownerId,
      historyVersion: admission.historyVersion,
      attemptId: admission.attempt.id,
    };
    const controller = new AbortController();
    this.active.set(ownerId, {
      historyVersion: ref.historyVersion,
      controller,
    });
    const interrupted: RunOutcome = {
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
    };
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<RunOutcome>((resolve) => {
      abortListener = () => resolve(interrupted);
      controller.signal.addEventListener('abort', abortListener, {
        once: true,
      });
    });
    const remainingMs = Math.max(
      0,
      admission.attempt.deadlineAt.getTime() - this.clock().getTime(),
    );
    const timer = setTimeout(() => controller.abort(), remainingMs);
    try {
      const history = await this.repository.context(
        ref,
        admission.turn.sequence,
      );
      const { messages, contextLimited } = selectContext(
        admission.turn.text,
        history,
        limits.maxContextBytes,
      );
      let outcome: RunOutcome;
      if (
        controller.signal.aborted ||
        this.clock().getTime() >= admission.attempt.deadlineAt.getTime()
      ) {
        controller.abort();
        outcome = interrupted;
      } else {
        try {
          outcome = await Promise.race([
            model.complete({
              model: limits.model,
              messages,
              tools: limits.allowedTools,
              maxContextBytes: limits.maxContextBytes,
              maxModelCalls: limits.maxModelCalls,
              maxOutputTokens: limits.maxOutputTokens,
              maxToolCalls: limits.maxToolCalls,
              signal: controller.signal,
            }),
            aborted,
          ]);
        } catch {
          // Never propagate provider payloads or uncertain exceptions to callers/logs.
          outcome = controller.signal.aborted
            ? interrupted
            : { state: 'failed', errorCode: 'PROVIDER_ERROR' };
        }
      }
      if (outcome.state === 'completed') {
        outcome = outcome.answer.trim()
          ? {
              ...outcome,
              contextLimited: contextLimited || outcome.contextLimited,
            }
          : { state: 'failed', errorCode: 'INVALID_RESPONSE' };
      }
      const attempt = await this.repository.finish(ref, outcome);
      if (!attempt) throw new ConversationError('STALE_HISTORY');
      return { ...admission, attempt };
    } finally {
      clearTimeout(timer);
      if (abortListener)
        controller.signal.removeEventListener('abort', abortListener);
      if (this.active.get(ownerId)?.controller === controller)
        this.active.delete(ownerId);
    }
  }
}
