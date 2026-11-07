import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationStream } from '../../apps/api/src/conversation/adapters/driving/http/conversation-stream.js';

function setup() {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  const stream = new ConversationStream(response);
  const event = {
    type: 'text_delta' as const,
    historyVersion: 0,
    turnId: 'turn',
    attemptId: 'attempt',
    delta: 'Hello\n🌱',
  };
  return { response, stream, event };
}

afterEach(() => vi.useRealTimers());

describe('SSE response delivery', () => {
  it('frames multiline text as JSON and cleans up heartbeat timers', () => {
    vi.useFakeTimers();
    const { response, stream, event } = setup();
    const write = vi.spyOn(response, 'write').mockReturnValue(true);
    stream.write(event);
    expect(response.getHeader('Content-Type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(response.getHeader('X-Accel-Buffering')).toBe('no');
    expect(write).toHaveBeenCalledWith(
      `event: text_delta\ndata: ${JSON.stringify(event)}\n\n`,
    );
    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenLastCalledWith(': keep-alive\n\n');
    stream.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds queued output and detaches a slow reader', () => {
    const { response, stream, event } = setup();
    // An unattached ServerResponse queues bytes as an unread network socket would.
    stream.write({ ...event, delta: 'a'.repeat(40_000) });
    stream.write({ ...event, delta: 'b'.repeat(40_000) });
    expect(response.destroyed).toBe(true);
    expect(response.writableLength).toBeLessThan(64 * 1024);
    stream.close();
  });

  it('drops text and heartbeats after disconnect without throwing to the caller', () => {
    vi.useFakeTimers();
    const { response, stream, event } = setup();
    const write = vi.spyOn(response, 'write').mockReturnValue(true);
    stream.write(event);
    response.emit('close');
    stream.write({ ...event, delta: 'Late' });
    vi.advanceTimersByTime(30_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    stream.close();
  });
});
