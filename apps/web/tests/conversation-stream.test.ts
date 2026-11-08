import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { SessionState } from '../src/features/auth/session-state';
import { ObsoleteSessionError } from '../src/features/auth/session-scope';
import { createConversationQueries } from '../src/features/conversation/conversation-queries';
import { streamConversationTurn } from '../src/features/conversation/conversation-stream-api';
import { readEventStream } from '../src/features/conversation/conversation-stream-reader';
import { ConversationApiError } from '../src/features/conversation/conversation-errors';
import { RequestError } from '../src/lib/api-request';
import { ObsoleteHistoryError } from '../src/features/conversation/conversation-scope';
import {
  accepted,
  completed,
  delta,
  final,
  frame,
  historyOf,
  running,
  streamInput,
} from './fixtures/conversation-stream';

const transport = vi.hoisted(() => {
  const fetch = vi.fn<(request: Request) => Promise<Response>>();
  const NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(value: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof value === 'string'
            ? new URL(value, 'http://mentor.test')
            : value,
          init,
        );
      }
    },
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch };
});
const encoder = new TextEncoder();
let source: ReadableStreamDefaultController<Uint8Array>;
let cancelled: ReturnType<typeof vi.fn<() => void>>;
let response: Response;
const clients: QueryClient[] = [];
function emit(text: string) {
  source.enqueue(encoder.encode(text));
}
function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(queryClient);
  const session = new SessionState(queryClient);
  const conversation = createConversationQueries(session.scope(), queryClient);
  queryClient.setQueryData(conversation.keys.history(), historyOf());
  return { queryClient, session, conversation };
}
beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'http://mentor.test' } });
  cancelled = vi.fn();
  response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
      },
      cancel: cancelled,
    }),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
  );
  transport.fetch.mockImplementation(async (request) =>
    request.url.endsWith('/csrf')
      ? Response.json({ token: 'a'.repeat(64) })
      : response,
  );
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  transport.fetch.mockClear();
});

describe('browser streaming through the generated API client', () => {
  it('delivers text before completion, sends CSRF/session settings, and accepts a persisted final answer', async () => {
    const progress = vi.fn();
    const work = streamConversationTurn(
      streamInput,
      progress,
      new AbortController().signal,
    );
    emit(frame(accepted));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(accepted));
    emit(frame(delta));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(delta));
    expect(progress).toHaveBeenCalledTimes(2);
    const request = transport.fetch.mock.calls[1]![0];
    expect(new URL(request.url).pathname).toBe(
      '/api/v1/conversation/turns/stream',
    );
    expect(request.credentials).toBe('same-origin');
    expect(request.headers.get('X-CSRF-Token')).toBe('a'.repeat(64));
    expect(request.cache).toBe('no-store');
    expect(await request.json()).toEqual(streamInput);
    emit(frame(final));
    expect(await work).toMatchObject(completed);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each(['\n', '\r\n', '\r'])(
    'decodes one-byte UTF-8 chunks, comments and multiple data lines using %j',
    async (ending) => {
      const bytes = encoder.encode(
        ': keep-alive\n\nevent: text_delta\ndata: {"text":\ndata: "😀 café"}\n\n'.replaceAll(
          '\n',
          ending,
        ),
      );
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      });
      const events: unknown[] = [];
      await readEventStream(
        body,
        new AbortController().signal,
        (name, data) => {
          events.push({ name, data: JSON.parse(data) });
          return true;
        },
      );
      expect(events).toEqual([
        { name: 'text_delta', data: { text: '😀 café' } },
      ]);
    },
  );

  it('does not treat a truncated stream as a completed answer', async () => {
    const work = streamConversationTurn(
      streamInput,
      vi.fn(),
      new AbortController().signal,
    );
    const failure = expect(work).rejects.toThrow('without a result');
    emit(frame(accepted) + frame(delta));
    source.close();
    await failure;
  });

  it.each([
    frame(delta),
    frame(accepted) + frame({ ...delta, attemptId: streamInput.requestId }),
    frame({ ...accepted, turn: { ...running.turn, text: 'Wrong input' } }),
    frame(accepted) + frame(accepted),
    frame(accepted).replace('event: accepted', 'event: result'),
    frame(accepted) + frame({ type: 'result', ...running }),
  ])('rejects invalid event order or identity', async (wire) => {
    const work = streamConversationTurn(
      streamInput,
      vi.fn(),
      new AbortController().signal,
    );
    const failure = expect(work).rejects.toThrow();
    emit(wire);
    source.close();
    await failure;
  });

  it('accepts a running replay without claiming a live connection or starting a second POST', async () => {
    const progress = vi.fn();
    const work = streamConversationTurn(
      streamInput,
      progress,
      new AbortController().signal,
    );
    emit(
      frame({ ...accepted, replayed: true }) +
        frame({ type: 'result', ...running }),
    );
    expect(await work).toMatchObject(running);
    expect(progress).toHaveBeenCalledWith({ ...accepted, replayed: true });
    expect(
      transport.fetch.mock.calls.filter(
        ([request]) => request.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('maps post-header failures to fixed errors without exposing server messages', async () => {
    const work = streamConversationTurn(
      streamInput,
      vi.fn(),
      new AbortController().signal,
    );
    const failure = expect(work).rejects.toThrow('could not be confirmed');
    emit(
      frame(accepted) +
        frame({
          ...delta,
          type: 'error',
          code: 'INTERNAL_ERROR',
          message: 'PRIVATE SERVER DETAIL',
        }),
    );
    await failure;
  });

  it.each([401, 403, 409])(
    'preserves JSON admission error semantics (%s)',
    async (status) => {
      response = Response.json(
        { statusCode: status, code: 'BUSY', message: 'PRIVATE DETAIL' },
        { status },
      );
      await expect(
        streamConversationTurn(
          streamInput,
          vi.fn(),
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(
        status === 409 ? ConversationApiError : RequestError,
      );
    },
  );

  it('closes a silent connection so the caller can recover through history', async () => {
    vi.useFakeTimers();
    const work = streamConversationTurn(
      streamInput,
      vi.fn(),
      new AbortController().signal,
    );
    const failure = expect(work).rejects.toThrow('stopped responding');
    await vi.advanceTimersByTimeAsync(30_001);
    await failure;
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('bounds incomplete frames and cancels the reader on malformed UTF-8', async () => {
    for (const bytes of [
      encoder.encode('x'.repeat(65_537)),
      Uint8Array.of(0xff),
    ]) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      await expect(
        readEventStream(body, new AbortController().signal, () => false),
      ).rejects.toThrow();
    }
  });

  it('aborts streaming and removes private state on a 401', async () => {
    const { session, queryClient, conversation } = setup();
    response = new Response(null, { status: 401 });
    await expect(
      conversation.stream(streamInput, vi.fn()),
    ).rejects.toBeInstanceOf(RequestError);
    expect(
      queryClient.getQueryData(conversation.keys.history()),
    ).toBeUndefined();
    expect(() => conversation.assertCurrent()).toThrow(ObsoleteSessionError);
    expect(session.scope().generation).toBe(1);
  });

  it('discards late events after session replacement, even if the transport ignores abort', async () => {
    const { session, queryClient, conversation } = setup();
    const progress = vi.fn();
    const work = conversation
      .stream(streamInput, progress)
      .catch((error: unknown) => error);
    emit(frame(accepted));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledOnce());
    session.replace(null);
    expect(await work).toBeInstanceOf(ObsoleteSessionError);
    expect(progress).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(conversation.keys.history()),
    ).toBeUndefined();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('publishes committed snapshots without duplicating turns or replacing terminal answers with running state', () => {
    const { queryClient, conversation } = setup();
    conversation.publish(running);
    conversation.publish(completed);
    conversation.publish(running);
    expect(queryClient.getQueryData(conversation.keys.history())).toEqual(
      historyOf(completed),
    );
  });

  it('detaches old-version streaming when a head read observes cleared history', async () => {
    const { conversation } = setup();
    const progress = vi.fn();
    const work = conversation
      .stream(streamInput, progress)
      .catch((error: unknown) => error);
    emit(frame(accepted));
    await vi.waitFor(() => expect(progress).toHaveBeenCalledOnce());
    response = Response.json({ ...historyOf(), historyVersion: 1 });
    await conversation.history();
    expect(await work).toBeInstanceOf(ObsoleteHistoryError);
    expect(progress).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(() => conversation.publish(completed)).toThrow(ObsoleteHistoryError);
  });
});
