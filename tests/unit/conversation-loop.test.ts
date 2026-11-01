import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationLoop } from '../../packages/backend/src/conversation/application/conversation-loop.js';
import type {
  Admission,
  RunLimits,
  Submission,
} from '../../packages/backend/src/conversation/application/conversation.contracts.js';
import type { ConversationModel } from '../../packages/backend/src/conversation/application/ports/conversation.model.js';
import type { ConversationRepository } from '../../packages/backend/src/conversation/application/ports/conversation.repository.js';
import type { RunOutcome } from '../../packages/backend/src/conversation/domain/conversation.js';

const limits: RunLimits = {
  model: 'fake-model',
  allowedTools: ['web_search'],
  deadlineMs: 1000,
  maxMessageBytes: 128,
  maxContextBytes: 200,
  maxOutputTokens: 100,
  maxToolCalls: 2,
};
const output: Extract<RunOutcome, { state: 'completed' }> = {
  state: 'completed',
  answer: 'A synthetic answer.',
  sources: [],
  activity: [],
  usage: null,
  contextLimited: false,
};

function setup() {
  const input: Submission = {
    ownerId: randomUUID(),
    historyVersion: 0,
    requestId: randomUUID(),
    text: 'New question',
  };
  const now = new Date();
  const admission: Admission = {
    execute: true,
    historyVersion: 0,
    turn: {
      id: randomUUID(),
      requestId: input.requestId,
      sequence: 3,
      text: input.text,
      createdAt: now,
    },
    attempt: {
      id: randomUUID(),
      turnId: randomUUID(),
      requestId: input.requestId,
      attemptNumber: 1,
      model: 'fake-model',
      state: 'running',
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 1000),
      finishedAt: null,
      answer: null,
      errorCode: null,
      sources: [],
      activity: [],
      inputTokens: null,
      outputTokens: null,
      contextLimited: false,
    },
  };
  admission.attempt.turnId = admission.turn.id;
  const repository = {
    submit: vi
      .fn<ConversationRepository['submit']>()
      .mockResolvedValue(admission),
    retry: vi
      .fn<ConversationRepository['retry']>()
      .mockResolvedValue(admission),
    context: vi.fn<ConversationRepository['context']>().mockResolvedValue([]),
    finish: vi.fn<ConversationRepository['finish']>().mockResolvedValue({
      ...admission.attempt,
      state: 'completed',
      answer: output.answer,
      errorCode: null,
      finishedAt: now,
    }),
    history: vi
      .fn<ConversationRepository['history']>()
      .mockResolvedValue({ historyVersion: 0, turns: [], nextCursor: null }),
    clear: vi.fn<ConversationRepository['clear']>().mockResolvedValue(1),
  } satisfies ConversationRepository;
  const model = {
    complete: vi.fn<ConversationModel['complete']>().mockResolvedValue(output),
  };
  return {
    input,
    admission,
    repository,
    model,
    loop: new ConversationLoop(repository, { enabled: true, model, limits }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bounded conversation execution', () => {
  it('keeps history and clearing available when execution is disabled', async () => {
    const { input, repository } = setup();
    const loop = new ConversationLoop(repository, { enabled: false });
    expect(await loop.history(input.ownerId)).toEqual({
      historyVersion: 0,
      turns: [],
      nextCursor: null,
    });
    expect(await loop.clear(input.ownerId, 0)).toBe(1);
    expect(repository.history).toHaveBeenCalledWith(input.ownerId, undefined);
    expect(repository.clear).toHaveBeenCalledWith(input.ownerId, 0);
  });

  it('rejects disabled submission and retry before admission, context, or provider work', async () => {
    const { input, admission, repository, model } = setup();
    const loop = new ConversationLoop(repository, { enabled: false });
    await expect(loop.submit(input)).rejects.toMatchObject({
      code: 'EXECUTION_UNAVAILABLE',
    });
    await expect(
      loop.retry({
        ownerId: input.ownerId,
        historyVersion: 0,
        turnId: admission.turn.id,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_UNAVAILABLE' });
    expect(repository.submit).not.toHaveBeenCalled();
    expect(repository.retry).not.toHaveBeenCalled();
    expect(repository.context).not.toHaveBeenCalled();
    expect(repository.finish).not.toHaveBeenCalled();
    expect(model.complete).not.toHaveBeenCalled();
  });

  it.each<Partial<RunLimits>>([
    { maxMessageBytes: 0 },
    { maxContextBytes: 127 },
    { maxOutputTokens: Infinity },
    { maxToolCalls: 1.5 },
    { deadlineMs: 300001 },
  ])('retains enabled execution limit validation: %j', (changed) => {
    const { repository, model } = setup();
    expect(
      () =>
        new ConversationLoop(repository, {
          enabled: true,
          model,
          limits: { ...limits, ...changed },
        }),
    ).toThrow('INVALID_INPUT');
  });

  it.each<{ allowedTools: RunLimits['allowedTools'] }>([
    { allowedTools: [] },
    { allowedTools: ['web_search'] },
  ])(
    'passes runtime tool availability without a per-message flag: $allowedTools',
    async ({ allowedTools }) => {
      const { input, repository, model } = setup();
      const loop = new ConversationLoop(repository, {
        enabled: true,
        model,
        limits: { ...limits, allowedTools },
      });
      await loop.submit(input);
      expect(model.complete.mock.calls[0]?.[0].tools).toEqual(allowedTools);
      // An available tool need not be used; the ordinary answer has no search activity.
      expect(repository.finish.mock.calls[0]?.[1]).toMatchObject({
        state: 'completed',
        activity: [],
      });
    },
  );

  it('applies current runtime permissions on retry rather than permissions stored with a message', async () => {
    const { input, admission, repository, model } = setup();
    const loop = new ConversationLoop(repository, {
      enabled: true,
      model,
      limits: { ...limits, allowedTools: [] },
    });
    await loop.retry({
      ownerId: input.ownerId,
      historyVersion: 0,
      requestId: randomUUID(),
      turnId: admission.turn.id,
    });
    expect(model.complete.mock.calls[0]?.[0].tools).toEqual([]);
  });

  it('sends the newest complete pairs in order and discloses omitted older context', async () => {
    const { input, loop, repository, model } = setup();
    repository.context.mockResolvedValue([
      { text: 'Recent question', answer: 'Recent answer' },
      { text: 'Old'.repeat(100), answer: 'Older answer' },
    ]);
    await loop.submit(input);
    expect(model.complete.mock.calls[0]?.[0].messages).toEqual([
      { role: 'user', text: 'Recent question' },
      { role: 'assistant', text: 'Recent answer' },
      { role: 'user', text: 'New question' },
    ]);
    expect(repository.finish.mock.calls[0]?.[1]).toMatchObject({
      state: 'completed',
      contextLimited: true,
    });
    expect(repository.clear).not.toHaveBeenCalled();
  });

  it('does not invoke the model or load context for an idempotent replay', async () => {
    const { input, loop, repository, model, admission } = setup();
    repository.submit.mockResolvedValue({ ...admission, execute: false });
    expect((await loop.submit(input)).execute).toBe(false);
    expect(model.complete).not.toHaveBeenCalled();
    expect(repository.context).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves the provider contextLimited flag: %s',
    async (contextLimited) => {
      const { input, loop, model, repository } = setup();
      model.complete.mockResolvedValue({ ...output, contextLimited });
      await loop.submit(input);
      expect(repository.finish.mock.calls[0]?.[1]).toMatchObject({
        state: 'completed',
        contextLimited,
      });
    },
  );

  it('selects context for a retry using the original accepted text', async () => {
    const { input, loop, model, repository, admission } = setup();
    repository.context.mockResolvedValue([
      { text: 'Recent question', answer: 'Recent answer' },
      { text: 'Old'.repeat(100), answer: 'Older answer' },
    ]);
    await loop.retry({
      ownerId: input.ownerId,
      historyVersion: 0,
      turnId: admission.turn.id,
      requestId: randomUUID(),
    });
    expect(model.complete.mock.calls[0]?.[0].messages).toEqual([
      { role: 'user', text: 'Recent question' },
      { role: 'assistant', text: 'Recent answer' },
      { role: 'user', text: admission.turn.text },
    ]);
    expect(repository.finish.mock.calls[0]?.[1]).toMatchObject({
      state: 'completed',
      contextLimited: true,
    });
  });

  it('aborts at the deadline even when a provider ignores cancellation, without retrying', async () => {
    vi.useFakeTimers();
    const { input, loop, repository, model, admission } = setup();
    model.complete.mockImplementation(() => new Promise(() => {}));
    repository.finish.mockResolvedValue({
      ...admission.attempt,
      state: 'interrupted',
      answer: null,
      errorCode: 'INTERRUPTED',
      finishedAt: admission.attempt.deadlineAt,
    });
    const running = loop.submit(input);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await running).attempt.state).toBe('interrupted');
    expect(model.complete.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(repository.finish.mock.calls[0]?.[1]).toEqual({
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips a provider request whose persisted deadline already elapsed', async () => {
    vi.useFakeTimers();
    const { input, loop, admission, model, repository } = setup();
    vi.setSystemTime(admission.attempt.deadlineAt);
    await loop.submit(input);
    expect(model.complete).not.toHaveBeenCalled();
    expect(repository.finish.mock.calls[0]?.[1]).toEqual({
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
    });
  });

  it('does not start provider work if context assembly consumes the deadline', async () => {
    vi.useFakeTimers();
    const { input, loop, admission, model, repository } = setup();
    repository.context.mockImplementation(async () => {
      vi.setSystemTime(admission.attempt.deadlineAt);
      return [];
    });
    await loop.submit(input);
    expect(model.complete).not.toHaveBeenCalled();
    expect(repository.finish.mock.calls[0]?.[1]).toEqual({
      state: 'interrupted',
      errorCode: 'INTERRUPTED',
    });
  });

  it('normalizes provider failures without exposing their payload', async () => {
    const { input, loop, model, repository } = setup();
    model.complete.mockRejectedValue(new Error('private provider details'));
    await loop.submit(input);
    expect(repository.finish.mock.calls[0]?.[1]).toEqual({
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
  });

  it('does not publish an empty answer as a successful result', async () => {
    const { input, loop, model, repository } = setup();
    model.complete.mockResolvedValue({ ...output, answer: '   ' });
    await loop.submit(input);
    expect(repository.finish.mock.calls[0]?.[1]).toEqual({
      state: 'failed',
      errorCode: 'INVALID_RESPONSE',
    });
  });

  it('keeps reported usage when an empty answer becomes a failure', async () => {
    const { input, loop, model, repository } = setup();
    const usage = { inputTokens: 11, outputTokens: 7 };
    model.complete.mockResolvedValue({ ...output, answer: '   ', usage });
    await loop.submit(input);
    expect(repository.finish.mock.calls[0]?.[1]).toEqual({
      state: 'failed',
      errorCode: 'INVALID_RESPONSE',
      usage,
    });
  });

  it('rejects invalid input before admission or provider work', async () => {
    const { input, loop, repository, model } = setup();
    for (const changed of [
      { text: ' ' },
      { text: 'a'.repeat(129) },
      { text: '🌱'.repeat(33) },
      // The text fits maxMessageBytes, but its JSON escapes exceed the context bound.
      { text: '"'.repeat(100) },
      { requestId: 'not-a-uuid' },
      { historyVersion: -1 },
    ]) {
      await expect(loop.submit({ ...input, ...changed })).rejects.toMatchObject(
        { code: 'INVALID_INPUT' },
      );
    }
    expect(repository.submit).not.toHaveBeenCalled();
    expect(model.complete).not.toHaveBeenCalled();
  });
});
