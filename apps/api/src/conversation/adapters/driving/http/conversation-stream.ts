import type { ServerResponse } from 'node:http';
import type { ConversationStreamEventDto } from './conversation.dto.js';

const maxBufferedBytes = 64 * 1024;

// The request handler owns execution. This writer only owns a disposable reader.
export class ConversationStream {
  private detached = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  started = false;

  constructor(private readonly response: ServerResponse) {
    response.once('close', this.detach);
    response.once('error', this.detach);
  }

  private detach = () => {
    this.detached = true;
    clearInterval(this.heartbeat);
  };

  write(event: ConversationStreamEventDto) {
    if (this.detached || this.response.destroyed) return;
    if (!this.started) {
      this.started = true;
      try {
        this.response.statusCode = 200;
        this.response.setHeader(
          'Content-Type',
          'text/event-stream; charset=utf-8',
        );
        this.response.setHeader(
          'Cache-Control',
          'private, no-store, no-transform',
        );
        this.response.setHeader('X-Accel-Buffering', 'no');
        this.response.flushHeaders();
      } catch {
        this.detach();
        this.response.destroy();
        return;
      }
      this.heartbeat = setInterval(() => this.send(': keep-alive\n\n'), 15_000);
      this.heartbeat.unref();
    }
    this.send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private send(frame: string) {
    if (this.detached || this.response.destroyed) return;
    // Never queue unbounded deltas or wait for a reader at the model boundary.
    if (
      this.response.writableLength + Buffer.byteLength(frame) >
      maxBufferedBytes
    ) {
      this.detach();
      this.response.destroy();
      return;
    }
    try {
      this.response.write(frame);
    } catch {
      this.detach();
      this.response.destroy();
    }
  }

  close() {
    clearInterval(this.heartbeat);
    if (this.started && !this.detached && !this.response.destroyed)
      this.response.end();
    this.detach();
    this.response.removeListener('close', this.detach);
    this.response.removeListener('error', this.detach);
  }
}
