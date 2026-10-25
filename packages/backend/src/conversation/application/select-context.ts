import type { CompletedTurn, ModelMessage } from './conversation.contracts.js';

export function contextByteLength(messages: readonly ModelMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).length;
}

// History arrives newest first. Keep its contiguous newest whole pairs,
// then send them chronologically followed by the current message.
export function selectContext(
  text: string,
  history: readonly CompletedTurn[],
  maxContextBytes: number,
): { messages: ModelMessage[]; contextLimited: boolean } {
  let messages: ModelMessage[] = [{ role: 'user', text }];
  let used = 0;
  for (const pair of history) {
    const candidate: ModelMessage[] = [
      { role: 'user', text: pair.text },
      { role: 'assistant', text: pair.answer },
      ...messages,
    ];
    if (used === 100 || contextByteLength(candidate) > maxContextBytes) break;
    messages = candidate;
    used += 1;
  }
  return { messages, contextLimited: used < history.length };
}
