import type { CompletedTurn, ModelMessage } from './conversation.contracts.js';
import type { PersonalContext } from './ports/conversation-profile.reader.js';
import { modelInputMessages } from './personal-context.js';

export class ContextLimitError extends Error {}

export function contextByteLength(
  messages: readonly ModelMessage[],
  personalContext: PersonalContext = [],
): number {
  return new TextEncoder().encode(
    JSON.stringify(modelInputMessages(messages, personalContext)),
  ).length;
}

export function selectContext(
  text: string,
  newestFirstHistory: readonly CompletedTurn[],
  maxContextBytes: number,
  personalContext: PersonalContext = [],
): { messages: ModelMessage[]; contextLimited: boolean } {
  let messages: ModelMessage[] = [{ role: 'user', text }];
  if (contextByteLength(messages, personalContext) > maxContextBytes)
    throw new ContextLimitError();
  let used = 0;
  for (const pair of newestFirstHistory) {
    const candidate: ModelMessage[] = [
      { role: 'user', text: pair.text },
      { role: 'assistant', text: pair.answer },
      ...messages,
    ];
    if (
      used === 100 ||
      contextByteLength(candidate, personalContext) > maxContextBytes
    )
      break;
    messages = candidate;
    used += 1;
  }
  return { messages, contextLimited: used < newestFirstHistory.length };
}
