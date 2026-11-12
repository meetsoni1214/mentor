import { ConversationError } from '../domain/conversation.js';
import type {
  Admission,
  AttemptReference,
  ConversationProgress,
  ConversationProgressObserver,
  RunLimits,
} from './conversation.contracts.js';
import type { ConversationModel } from './ports/conversation.model.js';
import type { ConversationRepository } from './ports/conversation.repository.js';
import type { ConversationProfileReader } from './ports/conversation-profile.reader.js';
import type { RunOutcome } from '../domain/conversation.js';
import {
  ContextLimitError,
  contextByteLength,
  selectContext,
} from './select-context.js';
import {
  clearHistorySchema,
  historyOptionsSchema,
  ownerIdSchema,
  parseConversationInput,
  retryTurnSchema,
  submitTurnSchema,
  turnIdSchema,
} from './conversation.validation.js';

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
    private readonly profile: ConversationProfileReader = {
      read: async () => [],
    },
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
        limits.deadlineMs,
      ].every((value) => Number.isSafeInteger(value) && value > 0) ||
      !limits.allowedTools.every((tool) => tool === 'web_search') ||
      limits.deadlineMs > 300_000 ||
      limits.maxContextBytes < limits.maxMessageBytes
    ) {
      throw new ConversationError('INVALID_INPUT');
    }
  }

  status() {
    return this.execution.enabled
      ? {
          enabled: true as const,
          limits: {
            model: this.execution.limits.model,
            maxMessageBytes: this.execution.limits.maxMessageBytes,
            maxContextBytes: this.execution.limits.maxContextBytes,
            maxOutputTokens: this.execution.limits.maxOutputTokens,
            deadlineMs: this.execution.limits.deadlineMs,
          },
        }
      : { enabled: false as const, limits: null };
  }

  async submit(
    ownerId: string,
    command: unknown,
    onProgress?: ConversationProgressObserver,
  ): Promise<Admission> {
    const input = {
      ...parseConversationInput(submitTurnSchema, command),
      ownerId: parseConversationInput(ownerIdSchema, ownerId),
    };
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
    return this.execute(input.ownerId, admission, execution, onProgress);
  }

  async retry(
    ownerId: string,
    turnId: string,
    command: unknown,
    onProgress?: ConversationProgressObserver,
  ): Promise<Admission> {
    const input = {
      ...parseConversationInput(retryTurnSchema, command),
      ownerId: parseConversationInput(ownerIdSchema, ownerId),
      turnId: parseConversationInput(turnIdSchema, turnId),
    };
    const execution = this.requireExecution();
    const admission = await this.repository.retry(input, execution.limits);
    return this.execute(input.ownerId, admission, execution, onProgress);
  }

  history(ownerId: string, options: unknown = {}) {
    return this.repository.history(
      parseConversationInput(ownerIdSchema, ownerId),
      parseConversationInput(historyOptionsSchema, options),
    );
  }

  async clear(ownerId: string, command: unknown): Promise<number> {
    parseConversationInput(ownerIdSchema, ownerId);
    const { historyVersion } = parseConversationInput(
      clearHistorySchema,
      command,
    );
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
    onProgress?: ConversationProgressObserver,
  ): Promise<Admission> {
    const notify = (progress: ConversationProgress) => {
      try {
        onProgress?.(progress);
      } catch {
        // A progress consumer must not change admission or model execution.
      }
    };
    notify({ type: 'accepted', admission });
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
    let delivering = true;
    try {
      let contextLimited = false;
      const run = async (): Promise<RunOutcome> => {
        const history = await this.repository.context(
          ref,
          admission.turn.sequence,
        );
        const personalContext = await this.profile.read(ownerId);
        const selected = selectContext(
          admission.turn.text,
          history,
          limits.maxContextBytes,
          personalContext,
        );
        const { messages } = selected;
        contextLimited = selected.contextLimited;
        if (
          controller.signal.aborted ||
          this.clock().getTime() >= admission.attempt.deadlineAt.getTime()
        ) {
          controller.abort();
          return interrupted;
        } else {
          return model.complete({
            model: limits.model,
            messages,
            personalContext,
            tools: limits.allowedTools,
            maxOutputTokens: limits.maxOutputTokens,
            maxToolCalls: limits.maxToolCalls,
            signal: controller.signal,
            ...(onProgress
              ? {
                  onTextDelta: (delta: string) => {
                    if (
                      delivering &&
                      !controller.signal.aborted &&
                      this.clock().getTime() <
                        admission.attempt.deadlineAt.getTime() &&
                      delta
                    )
                      notify({
                        type: 'text_delta',
                        historyVersion: ref.historyVersion,
                        turnId: admission.turn.id,
                        attemptId: ref.attemptId,
                        delta,
                      });
                  },
                }
              : {}),
          });
        }
      };
      let outcome: RunOutcome;
      try {
        outcome = await Promise.race([run(), aborted]);
      } catch (error) {
        if (error instanceof ConversationError) throw error;
        // Never propagate provider payloads or uncertain exceptions to callers/logs.
        outcome = controller.signal.aborted
          ? interrupted
          : {
              state: 'failed',
              errorCode:
                error instanceof ContextLimitError
                  ? 'LIMIT_EXCEEDED'
                  : 'PROVIDER_ERROR',
            };
      }
      delivering = false;
      if (outcome.state === 'completed') {
        outcome = outcome.answer.trim()
          ? {
              ...outcome,
              contextLimited: contextLimited || outcome.contextLimited,
            }
          : {
              state: 'failed',
              errorCode: 'INVALID_RESPONSE',
              ...(outcome.usage ? { usage: outcome.usage } : {}),
            };
      }
      const attempt = await this.repository.finish(ref, outcome);
      if (!attempt) throw new ConversationError('STALE_HISTORY');
      return { ...admission, attempt };
    } finally {
      delivering = false;
      clearTimeout(timer);
      if (abortListener)
        controller.signal.removeEventListener('abort', abortListener);
      if (this.active.get(ownerId)?.controller === controller)
        this.active.delete(ownerId);
    }
  }
}
