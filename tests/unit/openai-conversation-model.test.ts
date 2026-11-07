import {
  getGlobalTraceProvider,
  getLogger,
  setSensitiveDataLoggingEnabled,
  setTraceProcessors,
  setTracingDisabled,
  tool,
} from '@openai/agents';
import OpenAI from 'openai';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  OpenAIConversationModel,
  executeSDKConversation,
} from '../../packages/backend/src/conversation/adapters/openai-conversation.model.js';
import type { ConversationModel } from '../../packages/backend/src/conversation/application/ports/conversation.model.js';
import {
  createResponsesStub,
  response,
  startResponseStream,
  toolResponse,
} from '../fixtures/responses-stub.js';

type ModelInput = Parameters<ConversationModel['complete']>[0];
let stub: Awaited<ReturnType<typeof createResponsesStub>>;
let model: OpenAIConversationModel;
const traceEvents = vi.fn();
const syntheticStep = tool({
  name: 'synthetic_step',
  description: 'Synthetic local test only',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  execute: async () => 'Synthetic result',
});
function input(overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    model: 'test-model',
    messages: [{ role: 'user', text: 'Synthetic question' }],
    tools: [],
    maxOutputTokens: 100,
    maxToolCalls: 2,
    signal: new AbortController().signal,
    ...overrides,
  };
}
function client() {
  return new OpenAI({
    apiKey: 'synthetic-test-key',
    baseURL: stub.baseURL,
    maxRetries: 0,
    logLevel: 'off',
  });
}

beforeAll(async () => {
  stub = await createResponsesStub();
});
beforeEach(() => {
  stub.reset();
  setTracingDisabled(false);
  setSensitiveDataLoggingEnabled(true);
  setTraceProcessors([
    {
      onTraceStart: traceEvents,
      onTraceEnd: traceEvents,
      onSpanStart: traceEvents,
      onSpanEnd: traceEvents,
      forceFlush: async () => {},
      shutdown: async () => {},
    },
  ]);
  model = new OpenAIConversationModel('synthetic-test-key', {
    baseURL: stub.baseURL,
  });
});
afterEach(async () => {
  await getGlobalTraceProvider().forceFlush();
  expect(stub.unexpectedTraffic).toEqual([]);
  expect(traceEvents).not.toHaveBeenCalled();
});
afterAll(async () => {
  if (!stub) return;
  await getGlobalTraceProvider().shutdown();
  expect(stub.unexpectedTraffic).toEqual([]);
  await stub.close();
});

describe('standard Agents SDK / Responses adapter', () => {
  it('delivers only text deltas before final output and retains privacy controls and SDK usage', async () => {
    let stream!: ReturnType<typeof startResponseStream>;
    stub.replies.push((res) => {
      stream = startResponseStream(res);
      stream.event({
        type: 'response.reasoning_summary_text.delta',
        item_id: 'reason_stub',
        output_index: 1,
        summary_index: 0,
        delta: 'PRIVATE reasoning',
      });
      stream.delta('Hello ');
    });
    const onTextDelta = vi.fn();
    let settled = false;
    const running = model.complete(input({ onTextDelta })).then((result) => {
      settled = true;
      return result;
    });
    try {
      await vi.waitFor(() =>
        expect(onTextDelta).toHaveBeenCalledWith('Hello '),
      );
      expect(settled).toBe(false);
      expect(onTextDelta.mock.calls).toEqual([['Hello ']]);
      stream.delta('🌱\nworld');
    } finally {
      stream?.finish();
    }
    expect(await running).toMatchObject({
      state: 'completed',
      answer: 'Hello 🌱\nworld',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.body).toMatchObject({
      stream: true,
      store: false,
      max_output_tokens: 100,
    });
    expect(stub.requests[0]!.body).not.toHaveProperty('previous_response_id');
    expect(stub.requests[0]!.body).not.toHaveProperty('conversation');
  });

  it.each(['incomplete', 'failed'])(
    'keeps usage and a stable failure after streamed text followed by %s',
    async (status) => {
      const onTextDelta = vi.fn();
      stub.replies.push((res) => {
        const stream = startResponseStream(res);
        stream.delta('Provisional');
        stream.finish(status);
      });
      const result = await model.complete(input({ onTextDelta }));
      expect(onTextDelta).toHaveBeenCalledWith('Provisional');
      expect(result).toMatchObject({
        state: 'failed',
        errorCode: status === 'incomplete' ? 'INCOMPLETE' : 'PROVIDER_ERROR',
        usage: { inputTokens: 11, outputTokens: 7 },
      });
      expect(result).not.toHaveProperty('answer');
      expect(stub.requests).toHaveLength(1);
    },
  );

  it('does not let a text observer failure change a successful SDK outcome', async () => {
    stub.replies.push((res) => {
      const stream = startResponseStream(res);
      stream.delta('Saved answer');
      stream.finish();
    });
    expect(
      await model.complete(
        input({
          onTextDelta: () => {
            throw new Error('reader gone');
          },
        }),
      ),
    ).toMatchObject({ state: 'completed', answer: 'Saved answer' });
  });

  it('normalizes streamed refusals without exposing refusal content', async () => {
    stub.replies.push((res) => {
      const stream = startResponseStream(res);
      stream.event({
        type: 'response.completed',
        response: {
          ...response(),
          output: [
            {
              id: 'msg_stub',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'refusal', refusal: 'PRIVATE refusal' }],
            },
          ],
        },
      });
      res.end();
    });
    const result = await model.complete(input({ onTextDelta: vi.fn() }));
    expect(result).toMatchObject({
      state: 'failed',
      errorCode: 'REFUSED',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('does not retry a dropped stream after delivering provisional text', async () => {
    let disconnect!: () => void;
    const onTextDelta = vi.fn(() => disconnect());
    stub.replies.push((res) => {
      disconnect = () => res.destroy();
      startResponseStream(res).delta('Provisional');
    });
    const result = await model.complete(input({ onTextDelta }));
    expect(onTextDelta).toHaveBeenCalledExactlyOnceWith('Provisional');
    expect(result).toMatchObject({
      state: 'failed',
      errorCode: 'INVALID_RESPONSE',
    });
    expect(result).not.toHaveProperty('answer');
    expect(stub.requests).toHaveLength(1);
  });

  it('aborts an active text stream without retrying or delivering subsequent text', async () => {
    const controller = new AbortController();
    const onTextDelta = vi.fn(() => controller.abort());
    stub.replies.push((res) => startResponseStream(res).delta('First chunk'));
    expect(
      await model.complete(input({ onTextDelta, signal: controller.signal })),
    ).toMatchObject({ state: 'interrupted', errorCode: 'INTERRUPTED' });
    expect(onTextDelta).toHaveBeenCalledExactlyOnceWith('First chunk');
    expect(stub.requests).toHaveLength(1);
  });

  it('sends application-owned context through the standard SDK with privacy settings', async () => {
    stub.enqueue(response('We discussed gardens.'));
    expect(
      await model.complete(
        input({
          messages: [
            { role: 'user', text: 'Let us discuss gardens.' },
            { role: 'assistant', text: 'We can discuss native plants.' },
            { role: 'user', text: 'What were we discussing?' },
          ],
        }),
      ),
    ).toEqual({
      state: 'completed',
      answer: 'We discussed gardens.',
      sources: [],
      activity: [],
      usage: { inputTokens: 11, outputTokens: 7 },
      contextLimited: false,
    });
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.path).toBe('/v1/responses');
    expect(request.body).toMatchObject({
      model: 'test-model',
      store: false,
      stream: false,
      max_output_tokens: 100,
    });
    for (const field of [
      'conversation',
      'previous_response_id',
      'prompt',
      'background',
      'max_tool_calls',
      'truncation',
    ])
      expect(request.body).not.toHaveProperty(field);
    expect(request.body.tools ?? []).toEqual([]);
    expect(JSON.stringify(request.body.input)).toContain('native plants');
    expect(JSON.stringify(request.body.input)).toContain(
      'What were we discussing?',
    );
    expect(getLogger().dontLogModelData).toBe(true);
    expect(getLogger().dontLogToolData).toBe(true);
  });

  it('rebuilds a later turn from supplied history without response-ID chaining', async () => {
    stub.enqueue(response('A first answer'));
    await model.complete(input());
    stub.enqueue(response('A contextual follow-up'));
    await model.complete(
      input({
        messages: [
          { role: 'user', text: 'Synthetic question' },
          { role: 'assistant', text: 'A first answer' },
          { role: 'user', text: 'Explain that further.' },
        ],
      }),
    );
    expect(stub.requests).toHaveLength(2);
    expect(JSON.stringify(stub.requests[1]!.body.input)).toContain(
      'A first answer',
    );
    expect(stub.requests[1]!.body).not.toHaveProperty('previous_response_id');
  });

  it.each([400, 401, 408, 409, 429, 500, 503])(
    'does not retry HTTP %s or leak diagnostics',
    async (status) => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        stub.enqueue(
          {
            error: {
              message: 'PRIVATE diagnostic synthetic-test-key',
              type: 'api_error',
            },
          },
          status,
        );
        const result = await model.complete(input());
        expect(result).toMatchObject({
          state: 'failed',
          errorCode: status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR',
        });
        expect(stub.requests).toHaveLength(1);
        const exposed = JSON.stringify([
          result,
          errorLog.mock.calls,
          warningLog.mock.calls,
        ]);
        expect(exposed).not.toContain('PRIVATE');
        expect(exposed).not.toContain('synthetic-test-key');
      } finally {
        errorLog.mockRestore();
        warningLog.mockRestore();
      }
    },
  );

  it('does not retry a dropped connection', async () => {
    stub.replies.push((res) => res.destroy());
    expect(await model.complete(input())).toMatchObject({
      state: 'failed',
      errorCode: 'PROVIDER_ERROR',
    });
    expect(stub.requests).toHaveLength(1);
  });

  it.each([
    { status: 'incomplete', expected: 'INCOMPLETE' },
    { status: 'failed', expected: 'PROVIDER_ERROR' },
  ])(
    'normalizes the SDK failure for $status output',
    async ({ status, expected }) => {
      stub.enqueue({ ...response('Partial output'), status });
      expect(await model.complete(input())).toMatchObject({
        state: 'failed',
        errorCode: expected,
      });
    },
  );

  it('normalizes the SDK refusal without exposing its content', async () => {
    const raw = response();
    stub.enqueue({
      ...raw,
      output: [
        {
          ...raw.output[0],
          content: [{ type: 'refusal', refusal: 'PRIVATE refusal' }],
        },
      ],
    });
    const result = await model.complete(input());
    expect(result).toMatchObject({ state: 'failed', errorCode: 'REFUSED' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([{}, null, { ...response(), output: [null] }, response('   ')])(
    'normalizes invalid SDK output',
    async (body) => {
      stub.enqueue(body);
      expect(await model.complete(input())).toMatchObject({
        state: 'failed',
        errorCode: 'INVALID_RESPONSE',
      });
      expect(stub.requests).toHaveLength(1);
    },
  );

  it('aborts before a request starts', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await model.complete(input({ signal: controller.signal })),
    ).toMatchObject({ state: 'interrupted', errorCode: 'INTERRUPTED' });
    expect(stub.requests).toHaveLength(0);
  });

  it('passes cancellation through to a pending HTTP request', async () => {
    const controller = new AbortController();
    stub.replies.push(() => controller.abort());
    expect(
      await model.complete(input({ signal: controller.signal })),
    ).toMatchObject({ state: 'interrupted', errorCode: 'INTERRUPTED' });
    expect(stub.requests).toHaveLength(1);
  });

  it('honors the application deadline signal without retrying', async () => {
    stub.replies.push(() => {});
    expect(
      await model.complete(input({ signal: AbortSignal.timeout(40) })),
    ).toMatchObject({ state: 'interrupted', errorCode: 'INTERRUPTED' });
    expect(stub.requests).toHaveLength(1);
  });

  it('keeps production tools unregistered', async () => {
    expect(
      await model.complete(input({ tools: ['web_search'] })),
    ).toMatchObject({ state: 'failed', errorCode: 'PROVIDER_ERROR' });
    expect(stub.requests).toHaveLength(0);
  });

  it('normalizes an unregistered function call using the SDK error', async () => {
    stub.enqueue(toolResponse());
    expect(await model.complete(input())).toMatchObject({
      state: 'failed',
      errorCode: 'INVALID_RESPONSE',
    });
    expect(stub.requests).toHaveLength(1);
  });
});

describe('SDK behavior with test-only tools', () => {
  it('uses the normal per-call output setting and SDK aggregate usage', async () => {
    stub.enqueue(toolResponse(70));
    stub.enqueue(response('Final answer', 60));
    expect(
      await executeSDKConversation(client(), input(), [syntheticStep]),
    ).toMatchObject({
      state: 'completed',
      answer: 'Final answer',
      usage: { inputTokens: 22, outputTokens: 130 },
    });
    expect(
      stub.requests.map((request) => request.body.max_output_tokens),
    ).toEqual([100, 100]);
    for (const request of stub.requests) {
      expect(request.body.store).toBe(false);
      expect(request.body).not.toHaveProperty('previous_response_id');
      expect(request.body).not.toHaveProperty('max_tool_calls');
    }
  });

  it('uses the pinned SDK default iteration limit rather than a custom model-call budget', async () => {
    for (let step = 1; step <= 10; step++)
      stub.enqueue(toolResponse(7, [], step));
    expect(
      await executeSDKConversation(client(), input(), [syntheticStep]),
    ).toMatchObject({ state: 'failed', errorCode: 'LIMIT_EXCEEDED' });
    expect(stub.requests).toHaveLength(10);
  });

  it('accepts the SDK usage defaults when a provider omits usage', async () => {
    stub.enqueue({ ...toolResponse(), usage: undefined });
    stub.enqueue(response());
    expect(
      await executeSDKConversation(client(), input(), [syntheticStep]),
    ).toMatchObject({
      state: 'completed',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(stub.requests).toHaveLength(2);
  });

  it('lets the SDK carry intermediate results without a custom byte-budget check', async () => {
    const hugeStep = tool({
      name: 'synthetic_step',
      description: 'Synthetic large result',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => 'x'.repeat(40_000),
    });
    stub.enqueue(toolResponse());
    stub.enqueue(response());
    expect(
      await executeSDKConversation(client(), input(), [hugeStep]),
    ).toMatchObject({ state: 'completed' });
    expect(stub.requests[1]!.bytes).toBeGreaterThan(32_768);
  });

  it('passes cancellation between SDK steps', async () => {
    const controller = new AbortController();
    const cancelStep = tool({
      name: 'synthetic_step',
      description: 'Synthetic cancellation',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        controller.abort();
        return 'Cancelled';
      },
    });
    stub.enqueue(toolResponse());
    expect(
      await executeSDKConversation(
        client(),
        input({ signal: controller.signal }),
        [cancelStep],
      ),
    ).toMatchObject({ state: 'interrupted', errorCode: 'INTERRUPTED' });
    expect(stub.requests).toHaveLength(1);
  });
});
