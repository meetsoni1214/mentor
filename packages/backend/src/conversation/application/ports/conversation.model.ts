import type { RunOutcome } from '../../domain/conversation.js';

export interface ConversationModel {
  complete(input: {
    model: string;
    messages: Array<{ role: 'user' | 'assistant'; text: string }>;
    tools: ReadonlyArray<'web_search'>;
    maxOutputTokens: number;
    maxToolCalls: number;
    signal: AbortSignal;
  }): Promise<RunOutcome>;
}
