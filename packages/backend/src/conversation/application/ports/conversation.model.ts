import type { RunOutcome } from '../../domain/conversation.js';
import type { ModelMessage } from '../conversation.contracts.js';

export interface ConversationModel {
  complete(input: {
    model: string;
    messages: ModelMessage[];
    tools: ReadonlyArray<'web_search'>;
    maxContextBytes: number;
    maxModelCalls: number;
    maxOutputTokens: number;
    maxToolCalls: number;
    signal: AbortSignal;
  }): Promise<RunOutcome>;
}
