import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

export function response(answer = 'A synthetic answer', outputTokens = 7) {
  return {
    id: 'resp_stub',
    object: 'response',
    created_at: 1,
    model: 'test-model',
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [
      {
        id: 'msg_stub',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: answer, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 11,
      output_tokens: outputTokens,
      total_tokens: 11 + outputTokens,
    },
  };
}

export function toolResponse(
  outputTokens = 7,
  extra: unknown[] = [],
  step = 1,
) {
  return {
    ...response('', outputTokens),
    output: [
      ...extra,
      {
        id: `fc_stub_${step}`,
        type: 'function_call',
        name: 'synthetic_step',
        call_id: `call_stub_${step}`,
        arguments: '{}',
        status: 'completed',
      },
    ],
  };
}

type Reply = (res: ServerResponse) => void;

export function startResponseStream(res: ServerResponse) {
  let sequence = 0;
  let answer = '';
  const event = (value: Record<string, unknown>) => {
    res.write(
      `data: ${JSON.stringify({ sequence_number: sequence++, ...value })}\n\n`,
    );
  };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  event({
    type: 'response.created',
    response: { ...response(''), status: 'in_progress', output: [] },
  });
  event({
    type: 'response.output_item.added',
    output_index: 0,
    item: { ...response('').output[0], status: 'in_progress', content: [] },
  });
  return {
    event,
    delta(text: string) {
      answer += text;
      event({
        type: 'response.output_text.delta',
        item_id: 'msg_stub',
        output_index: 0,
        content_index: 0,
        delta: text,
      });
    },
    finish(status = 'completed') {
      event({
        type: `response.${status}`,
        response: { ...response(answer), status },
      });
      res.end();
    },
  };
}

export async function createResponsesStub() {
  const requests: {
    path: string;
    body: Record<string, unknown>;
    bytes: number;
  }[] = [];
  const replies: Reply[] = [];
  const unexpectedTraffic: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    requests.push({
      path: req.url ?? '',
      body: JSON.parse(bytes.toString()) as Record<string, unknown>,
      bytes: bytes.length,
    });
    const reply = replies.shift();
    if (req.method !== 'POST' || req.url !== '/v1/responses' || !reply) {
      unexpectedTraffic.push(req.url ?? 'unknown');
      res.writeHead(500).end();
      return;
    }
    reply(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${port}/v1`;
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  dispatcher.enableNetConnect(`127.0.0.1:${port}`);
  const dispatch = dispatcher.dispatch.bind(dispatcher);
  dispatcher.dispatch = (options, handler) => {
    // Also catch SDK code that captured native fetch before this fixture replaced
    // global fetch. A swallowed telemetry error must still fail the suite.
    const origin = String(options.origin);
    if (origin !== new URL(baseURL).origin) unexpectedTraffic.push(origin);
    return dispatch(options, handler);
  };
  const previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(dispatcher);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== new URL(baseURL).origin) {
      unexpectedTraffic.push(url.origin);
      return Promise.reject(new Error('Non-stub outbound traffic denied'));
    }
    return originalFetch(input, init);
  };
  return {
    baseURL,
    requests,
    replies,
    unexpectedTraffic,
    enqueue(body: unknown, status = 200) {
      replies.push((res) =>
        res
          .writeHead(status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(body)),
      );
    },
    reset() {
      requests.length = 0;
      replies.length = 0;
      unexpectedTraffic.length = 0;
    },
    async close() {
      globalThis.fetch = originalFetch;
      setGlobalDispatcher(previousDispatcher);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await dispatcher.close();
    },
  };
}
