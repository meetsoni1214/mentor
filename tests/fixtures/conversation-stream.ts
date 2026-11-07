import type { ConversationStreamEventDto } from '../../apps/api/src/conversation/adapters/driving/http/conversation.dto.js';

export async function collectEvents(
  source: AsyncIterable<ConversationStreamEventDto>,
) {
  const events: ConversationStreamEventDto[] = [];
  for await (const event of source) events.push(event);
  return events;
}

// Decode the actual HTTP stream incrementally, including split UTF-8/SSE frames.
export async function* conversationEvents(response: Response) {
  if (!response.body) throw new Error('Missing response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffered.indexOf('\n\n')) >= 0) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        if (frame.startsWith(':')) continue;
        const data = frame
          .split('\n')
          .find((line) => line.startsWith('data: '));
        if (!data) throw new Error('Missing event data');
        const event = JSON.parse(data.slice(6)) as ConversationStreamEventDto;
        if (!frame.startsWith(`event: ${event.type}\n`))
          throw new Error('Event type mismatch');
        yield event;
      }
      if (done) {
        if (buffered.trim()) throw new Error('Truncated SSE frame');
        return;
      }
    }
  } finally {
    await reader.cancel();
  }
}
