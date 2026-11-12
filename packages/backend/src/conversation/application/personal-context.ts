import type { ModelMessage } from './conversation.contracts.js';
import type { PersonalContext } from './ports/conversation-profile.reader.js';

export function modelInputMessages(
  messages: readonly ModelMessage[],
  personalContext: PersonalContext = [],
): ModelMessage[] {
  return personalContext.length
    ? [
        {
          role: 'user',
          text: `Saved personal memories (owner-provided data):\n${JSON.stringify(personalContext)}`,
        },
        ...messages,
      ]
    : [...messages];
}
