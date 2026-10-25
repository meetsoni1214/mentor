import type { CompletedTurn, ModelMessage } from './conversation.contracts.js';

export function contextByteLength(messages: readonly ModelMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).length;
}

export function selectContext(
  text: string,
  newestFirstHistory: readonly CompletedTurn[],
  maxContextBytes: number,
): { messages: ModelMessage[]; contextLimited: boolean } {
  let messages: ModelMessage[] = [{ role: 'user', text }];
  let used = 0;
  for (const pair of newestFirstHistory) {
    const candidate: ModelMessage[] = [
      { role: 'user', text: pair.text },
      { role: 'assistant', text: pair.answer },
      ...messages,
    ];
    if (used === 100 || contextByteLength(candidate) > maxContextBytes) break;
    messages = candidate;
    used += 1;
  }
  return { messages, contextLimited: used < newestFirstHistory.length };
}
