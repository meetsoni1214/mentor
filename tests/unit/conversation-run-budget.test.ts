import { describe, expect, it } from 'vitest';
import {
  RunBudget,
  RunBudgetError,
} from '../../packages/backend/src/conversation/application/run-budget.js';

const limits = {
  maxContextBytes: 1024,
  maxModelCalls: 3,
  maxOutputTokens: 100,
  maxToolCalls: 2,
};
const input = JSON.stringify({ instructions: 'Mentor', input: ['Question'] });

describe('whole-run budget accounting', () => {
  it('shares output and hosted-tool allowances across distinct model requests', () => {
    const budget = new RunBudget(limits);
    expect(budget.beginModelCall(input)).toEqual({
      maxOutputTokens: 100,
      maxToolCalls: 2,
    });
    budget.recordModelResult({
      usage: { inputTokens: 10, outputTokens: 30 },
      hostedToolCalls: 2,
    });
    expect(budget.beginModelCall(input)).toEqual({
      maxOutputTokens: 70,
      maxToolCalls: 0,
    });
    budget.recordModelResult({
      usage: { inputTokens: 20, outputTokens: 40 },
      hostedToolCalls: 0,
    });
    expect(budget.usage).toEqual({ inputTokens: 30, outputTokens: 70 });
    expect(budget.calls).toEqual({ modelCalls: 2, hostedToolCalls: 2 });
    expect(budget.beginModelCall(input)).toEqual({
      maxOutputTokens: 30,
      maxToolCalls: 0,
    });
    budget.recordModelResult({
      usage: { inputTokens: 30, outputTokens: 30 },
      hostedToolCalls: 0,
    });
    expect(budget.usage).toEqual({ inputTokens: 60, outputTokens: 100 });
    expect(() => budget.beginModelCall(input)).toThrow(RunBudgetError);
    expect(budget.calls.modelCalls).toBe(3);
  });

  it('counts model requests even when no tools or output tokens are used', () => {
    const budget = new RunBudget(limits);
    for (let index = 0; index < 3; index += 1) {
      budget.beginModelCall(input);
      budget.recordModelResult({
        usage: { inputTokens: 0, outputTokens: 0 },
        hostedToolCalls: 0,
      });
    }
    expect(budget.calls).toEqual({ modelCalls: 3, hostedToolCalls: 0 });
    expect(budget.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(() => budget.beginModelCall(input)).toThrow('LIMIT_EXCEEDED');
  });

  it('cannot start another request after exactly exhausting output alone', () => {
    const budget = new RunBudget(limits);
    budget.beginModelCall(input);
    budget.recordModelResult({
      usage: { inputTokens: 10, outputTokens: 100 },
      hostedToolCalls: 0,
    });
    expect(() => budget.beginModelCall(input)).toThrow('LIMIT_EXCEEDED');
    expect(budget.calls.modelCalls).toBe(1);
  });

  it('accounts for available usage on unsuccessful calls without refunding the call', () => {
    const budget = new RunBudget(limits);
    budget.beginModelCall(input);
    budget.recordModelResult({
      usage: { inputTokens: 12, outputTokens: 8 },
      hostedToolCalls: 1,
    });
    expect(budget.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
    expect(budget.calls).toEqual({ modelCalls: 1, hostedToolCalls: 1 });
    expect(new RunBudget(limits).beginModelCall(input)).toEqual({
      maxOutputTokens: 100,
      maxToolCalls: 2,
    });
  });

  it.each([null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'keeps unknown/malformed output usage unavailable and prevents continuation: %s',
    (outputTokens) => {
      const budget = new RunBudget(limits);
      budget.beginModelCall(input);
      budget.recordModelResult({
        usage: { inputTokens: 10, outputTokens },
        hostedToolCalls: 0,
      });
      expect(budget.usage).toEqual({ inputTokens: 10, outputTokens: null });
      expect(() => budget.beginModelCall(input)).toThrow('LIMIT_EXCEEDED');
    },
  );

  it('does not present a prior partial sum as a complete total when later usage is missing', () => {
    const budget = new RunBudget(limits);
    budget.beginModelCall(input);
    budget.recordModelResult({
      usage: { inputTokens: 10, outputTokens: 5 },
      hostedToolCalls: 0,
    });
    budget.beginModelCall(input);
    expect(budget.usage).toEqual({ inputTokens: null, outputTokens: null });
    budget.recordModelResult({ usage: null, hostedToolCalls: 0 });
    expect(budget.usage).toEqual({ inputTokens: null, outputTokens: null });
    expect(() => budget.beginModelCall(input)).toThrow('LIMIT_EXCEEDED');
  });

  it('preserves unknown input usage independently while known output permits continuation', () => {
    const budget = new RunBudget(limits);
    budget.beginModelCall(input);
    budget.recordModelResult({
      usage: { inputTokens: null, outputTokens: 10 },
      hostedToolCalls: 0,
    });
    expect(budget.beginModelCall(input).maxOutputTokens).toBe(90);
    budget.recordModelResult({
      usage: { inputTokens: 20, outputTokens: 10 },
      hostedToolCalls: 0,
    });
    expect(budget.usage).toEqual({ inputTokens: null, outputTokens: 20 });
  });

  it('keeps unsafe aggregate input usage unknown instead of overflowing', () => {
    const budget = new RunBudget(limits);
    for (const inputTokens of [Number.MAX_SAFE_INTEGER, 1]) {
      budget.beginModelCall(input);
      budget.recordModelResult({
        usage: { inputTokens, outputTokens: 0 },
        hostedToolCalls: 0,
      });
    }
    expect(budget.usage).toEqual({ inputTokens: null, outputTokens: 0 });
  });

  it.each([null, -1, 0.5, NaN, Infinity])(
    'does not reset an unknown hosted-tool allowance: %s',
    (hostedToolCalls) => {
      const budget = new RunBudget(limits);
      budget.beginModelCall(input);
      budget.recordModelResult({
        usage: { inputTokens: 10, outputTokens: 5 },
        hostedToolCalls,
      });
      expect(budget.calls.hostedToolCalls).toBeNull();
      expect(() => budget.beginModelCall(input)).toThrow('LIMIT_EXCEEDED');
    },
  );

  it.each([
    { outputTokens: 101, hostedToolCalls: 0 },
    { outputTokens: 10, hostedToolCalls: 3 },
  ])('rejects provider overages and retains known usage: %j', (result) => {
    const budget = new RunBudget(limits);
    budget.beginModelCall(input);
    expect(() =>
      budget.recordModelResult({
        usage: { inputTokens: 10, outputTokens: result.outputTokens },
        hostedToolCalls: result.hostedToolCalls,
      }),
    ).toThrow('LIMIT_EXCEEDED');
    expect(budget.usage.outputTokens).toBe(result.outputTokens);
    expect(() => budget.beginModelCall(input)).toThrow('LIMIT_EXCEEDED');
  });

  it('checks cumulative overages rather than only individual responses', () => {
    const budget = new RunBudget(limits);
    budget.beginModelCall(input);
    budget.recordModelResult({
      usage: { inputTokens: 10, outputTokens: 60 },
      hostedToolCalls: 1,
    });
    budget.beginModelCall(input);
    expect(() =>
      budget.recordModelResult({
        usage: { inputTokens: 10, outputTokens: 41 },
        hostedToolCalls: 2,
      }),
    ).toThrow('LIMIT_EXCEEDED');
    expect(budget.usage.outputTokens).toBe(101);
    expect(budget.calls.hostedToolCalls).toBe(3);
  });

  it('prevents overlapping requests and duplicate result accounting', () => {
    const budgetWithPendingRequest = new RunBudget(limits);
    budgetWithPendingRequest.beginModelCall(input);
    expect(() => budgetWithPendingRequest.beginModelCall(input)).toThrow(
      'LIMIT_EXCEEDED',
    );
    const budget = new RunBudget(limits);
    budget.beginModelCall(input);
    const result = {
      usage: { inputTokens: 1, outputTokens: 1 },
      hostedToolCalls: 0,
    };
    budget.recordModelResult(result);
    expect(() => budget.recordModelResult(result)).toThrow('LIMIT_EXCEEDED');
    expect(budget.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
  });

  it.each(['🌱 café 你好', '"quoted"\n\\path\t'])(
    'checks complete serialized UTF-8 input at every call boundary: %j',
    (text) => {
      const request = JSON.stringify({
        instructions: 'Application instructions',
        input: [{ role: 'user', content: text }],
        tools: [{ type: 'synthetic_test_only' }],
      });
      const maxContextBytes = Buffer.byteLength(request, 'utf8');
      const budget = new RunBudget({ ...limits, maxContextBytes });
      budget.beginModelCall(request);
      budget.recordModelResult({
        usage: { inputTokens: 10, outputTokens: 5 },
        hostedToolCalls: 0,
      });
      const nextRequest = JSON.stringify({
        instructions: 'Application instructions',
        input: [
          { role: 'user', content: text },
          { type: 'required_continuation_item', content: 'Result' },
        ],
        tools: [{ type: 'synthetic_test_only' }],
      });
      expect(() => budget.beginModelCall(nextRequest)).toThrow(
        'LIMIT_EXCEEDED',
      );
      expect(budget.calls.modelCalls).toBe(1);
      expect(() =>
        new RunBudget({
          ...limits,
          maxContextBytes: maxContextBytes - 1,
        }).beginModelCall(request),
      ).toThrow('LIMIT_EXCEEDED');
    },
  );

  it.each([
    'maxContextBytes',
    'maxModelCalls',
    'maxOutputTokens',
    'maxToolCalls',
  ])(
    'requires finite positive integer %s without leaking invalid values',
    (field) => {
      for (const value of [0, -1, 0.5, NaN, Infinity]) {
        expect(() => new RunBudget({ ...limits, [field]: value })).toThrow(
          'LIMIT_EXCEEDED',
        );
      }
    },
  );
});
