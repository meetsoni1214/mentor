import type { TokenUsage } from '../domain/conversation.js';
import type { RunLimits } from './conversation.contracts.js';

type BudgetLimits = Pick<
  RunLimits,
  'maxContextBytes' | 'maxModelCalls' | 'maxOutputTokens' | 'maxToolCalls'
>;

export class RunBudgetError extends Error {
  readonly code = 'LIMIT_EXCEEDED';

  constructor() {
    // Provider diagnostics can contain private request data.
    super('LIMIT_EXCEEDED');
  }
}

function count(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function add(total: number | null, next: number | null): number | null {
  return total === null || next === null ? null : count(total + next);
}

// A budget belongs to one attempt so allowances cannot reset between model calls.
export class RunBudget {
  private readonly limits: BudgetLimits;
  private modelCalls = 0;
  private toolCalls: number | null = 0;
  private inputTokens: number | null = 0;
  private outputTokens: number | null = 0;
  private modelRequestPending = false;
  private exhausted = false;

  constructor(limits: BudgetLimits) {
    if (
      ![
        limits.maxContextBytes,
        limits.maxModelCalls,
        limits.maxOutputTokens,
        limits.maxToolCalls,
      ].every((value) => Number.isSafeInteger(value) && value > 0)
    )
      throw new RunBudgetError();
    this.limits = { ...limits };
  }

  get usage(): TokenUsage {
    return {
      inputTokens: this.modelRequestPending ? null : this.inputTokens,
      outputTokens: this.modelRequestPending ? null : this.outputTokens,
    };
  }

  get calls(): { modelCalls: number; hostedToolCalls: number | null } {
    return {
      modelCalls: this.modelCalls,
      hostedToolCalls: this.modelRequestPending ? null : this.toolCalls,
    };
  }

  beginModelCall(serializedInput: string): {
    maxOutputTokens: number;
    maxToolCalls: number;
  } {
    // Transcript size alone misses instructions and required continuation items.
    if (
      this.modelRequestPending ||
      this.exhausted ||
      this.modelCalls >= this.limits.maxModelCalls ||
      this.outputTokens === null ||
      this.outputTokens >= this.limits.maxOutputTokens ||
      this.toolCalls === null ||
      new TextEncoder().encode(serializedInput).length >
        this.limits.maxContextBytes
    ) {
      this.exhausted = true;
      throw new RunBudgetError();
    }
    const allowance = {
      maxOutputTokens: this.limits.maxOutputTokens - this.outputTokens,
      maxToolCalls: this.limits.maxToolCalls - this.toolCalls,
    };
    this.modelCalls += 1;
    this.modelRequestPending = true;
    return allowance;
  }

  recordModelResult(result: {
    usage: TokenUsage | null;
    hostedToolCalls: number | null;
  }): void {
    if (!this.modelRequestPending) {
      this.exhausted = true;
      throw new RunBudgetError();
    }
    this.modelRequestPending = false;
    this.inputTokens = add(this.inputTokens, count(result.usage?.inputTokens));
    this.outputTokens = add(
      this.outputTokens,
      count(result.usage?.outputTokens),
    );
    this.toolCalls = add(this.toolCalls, count(result.hostedToolCalls));
    // Preserve observed usage for reporting even when the attempt must fail.
    if (
      (this.outputTokens !== null &&
        this.outputTokens > this.limits.maxOutputTokens) ||
      (this.toolCalls !== null && this.toolCalls > this.limits.maxToolCalls)
    ) {
      this.exhausted = true;
      throw new RunBudgetError();
    }
  }
}
