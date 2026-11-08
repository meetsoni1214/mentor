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
import { getGlobalTraceProvider, tool } from '@openai/agents';
import OpenAI from 'openai';
import {
  OpenAIConversationModel,
  executeSDKConversation,
} from '../../packages/backend/src/conversation/adapters/openai-conversation.model.js';
import type { ConversationModel } from '../../packages/backend/src/conversation/application/ports/conversation.model.js';
import {
  createResponsesStub,
  response,
  toolResponse,
  webSearchCall,
} from '../fixtures/responses-stub.js';
import {
  adversarialEmail,
  adversarialPage,
  fabricatedActionClaims,
  forbiddenInvestigationCall,
  forbiddenInvestigationTools,
  railwayCitation,
  railwayInvestigationResponse,
  railwayPublicAnswer,
  railwayQuestion,
} from '../fixtures/conversation-investigation.js';

type ModelInput = Parameters<ConversationModel['complete']>[0];
const runtimeSecret = 'SYNTHETIC_NOT_A_CREDENTIAL_43';
const providerKey = 'synthetic-investigation-key';
let stub: Awaited<ReturnType<typeof createResponsesStub>>;
let model: OpenAIConversationModel;

function input(text: string, overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    model: 'test-model',
    messages: [{ role: 'user', text }],
    tools: ['web_search'],
    maxOutputTokens: 100,
    maxToolCalls: 2,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function expectPublicSearchOnly(body: Record<string, unknown>) {
  expect(body.tools).toEqual([expect.objectContaining({ type: 'web_search' })]);
  expect(body).toMatchObject({ store: false, tool_choice: 'auto' });
  const modelContext = JSON.stringify({
    instructions: body.instructions,
    input: body.input,
    tools: body.tools,
  });
  expect(modelContext).not.toContain(runtimeSecret);
  expect(modelContext).not.toContain(providerKey);
}

beforeAll(async () => {
  stub = await createResponsesStub();
});
beforeEach(() => {
  stub.reset();
  vi.stubEnv('MENTOR_TEST_ACCOUNT_SECRET', runtimeSecret);
  model = new OpenAIConversationModel(providerKey, { baseURL: stub.baseURL });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await getGlobalTraceProvider().forceFlush();
  expect(stub.unexpectedTraffic).toEqual([]);
});
afterAll(async () => {
  if (!stub) return;
  try {
    await getGlobalTraceProvider().shutdown();
    expect(stub.unexpectedTraffic).toEqual([]);
  } finally {
    await stub.close();
  }
});

describe('synthetic investigation permission and evidence boundaries', () => {
  it('keeps a pasted Railway notice in user context and publishes only its observed public evidence', async () => {
    stub.enqueue(railwayInvestigationResponse());
    expect(await model.complete(input(railwayQuestion))).toMatchObject({
      state: 'completed',
      answer: railwayPublicAnswer,
      sources: [railwayCitation],
      activity: [{ type: 'web_search', status: 'completed' }],
    });
    expect(stub.requests).toHaveLength(1);
    const body = stub.requests[0]!.body;
    expectPublicSearchOnly(body);
    expect(body.input).toMatchObject([{ role: 'user' }]);
    expect(JSON.stringify(body.input)).toContain(
      JSON.stringify(railwayQuestion),
    );
    expect(body.instructions).not.toContain('SYNTHETIC RAILWAY NOTICE');
  });

  it.each(forbiddenInvestigationTools)(
    'rejects an email-induced %s call without another provider request',
    async (name) => {
      stub.enqueue(forbiddenInvestigationCall(name));
      const outcome = await model.complete(input(adversarialEmail));
      expect(outcome).toMatchObject({
        state: 'failed',
        errorCode: 'INVALID_RESPONSE',
      });
      expect(outcome).not.toHaveProperty('answer');
      expect(stub.requests).toHaveLength(1);
      const body = stub.requests[0]!.body;
      expectPublicSearchOnly(body);
      expect(body.input).toMatchObject([{ role: 'user' }]);
      expect(JSON.stringify(body.input)).toContain(
        JSON.stringify(adversarialEmail),
      );
      expect(body.instructions).not.toContain('ATTACK_FIXTURE_EMAIL');
      expect(JSON.stringify(outcome)).not.toContain(runtimeSecret);
      expect(JSON.stringify(outcome)).not.toContain('ATTACK_FIXTURE_EMAIL');
    },
  );

  it('keeps a retrieved page in a test-only tool result and rejects its requested credential access', async () => {
    // Hosted page content is provider-managed. This synthetic reader exercises
    // SDK continuation and isolation; it is never registered in production.
    const retrievePage = vi.fn(async () => adversarialPage);
    const pageTool = tool({
      name: 'synthetic_step',
      description: 'Local fixture reader, never a production tool',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: retrievePage,
    });
    stub.enqueue(toolResponse(7, [webSearchCall()]));
    stub.enqueue(forbiddenInvestigationCall('read_runtime_credentials'));
    const client = new OpenAI({
      apiKey: providerKey,
      baseURL: stub.baseURL,
      maxRetries: 0,
      logLevel: 'off',
    });
    expect(
      await executeSDKConversation(client, input(railwayQuestion), [pageTool]),
    ).toMatchObject({ state: 'failed', errorCode: 'INVALID_RESPONSE' });
    expect(retrievePage).toHaveBeenCalledTimes(1);
    expect(stub.requests).toHaveLength(2);
    const continued = stub.requests[1]!.body;
    expect(continued.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          output: adversarialPage,
        }),
      ]),
    );
    expect(continued.instructions).not.toContain('ATTACK_FIXTURE_PAGE');
    expect(continued.tools).toEqual([
      expect.objectContaining({ type: 'web_search' }),
      expect.objectContaining({ type: 'function', name: 'synthetic_step' }),
    ]);
    expect(JSON.stringify(continued)).not.toContain(runtimeSecret);
    expect(JSON.stringify(continued)).not.toContain(providerKey);
  });

  it('does not manufacture recorded actions or searches from fabricated answer prose', async () => {
    // Deliberately dishonest stub text shows the limit: evidence normalization
    // cannot certify or repair arbitrary prose, even when tool permissions hold.
    stub.enqueue(response(fabricatedActionClaims));
    expect(await model.complete(input(adversarialEmail))).toMatchObject({
      state: 'completed',
      answer: fabricatedActionClaims,
      sources: [],
      activity: [],
    });
    expect(stub.requests).toHaveLength(1);
    expectPublicSearchOnly(stub.requests[0]!.body);
  });
});
