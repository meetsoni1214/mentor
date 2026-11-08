// SSE framing is independent of conversation events and browser state.
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: string, data: string) => boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let event = '';
  let data: string[] = [];
  let size = 0;
  let skipLineFeed = false;
  let done = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let failure: Error | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });

  function consume(text: string) {
    for (const character of text) {
      if (done) return;
      if (skipLineFeed && character === '\n') {
        skipLineFeed = false;
        continue;
      }
      skipLineFeed = character === '\r';
      if (++size > 64 * 1024) throw new Error('Stream frame is too large.');
      if (character !== '\r' && character !== '\n') {
        line += character;
        continue;
      }
      if (!line) {
        if (data.length) done = onEvent(event || 'message', data.join('\n'));
        event = '';
        data = [];
        size = 0;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        if (field === 'data') data.push(value);
      }
      line = '';
    }
  }

  try {
    while (!done) {
      signal.throwIfAborted();
      // Backend heartbeats arrive every 15 seconds. A silent connection recovers
      // through history; this closes only the reader, not admitted model work.
      timeout = setTimeout(() => {
        failure = new Error('Stream stopped responding.');
        cancel();
      }, 30_000);
      const chunk = await reader.read();
      clearTimeout(timeout);
      signal.throwIfAborted();
      if (failure) throw failure;
      consume(decoder.decode(chunk.value, { stream: !chunk.done }));
      if (chunk.done && !done)
        throw new Error('Stream ended without a result.');
    }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
