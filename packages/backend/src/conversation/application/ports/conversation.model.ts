import type { RunOutcome } from '../../domain/conversation.js';
import type { ModelMessage } from '../conversation.contracts.js';
import type { PersonalContext } from './conversation-profile.reader.js';

export interface ConversationModel {
  complete(input: {
    model: string;
    messages: ModelMessage[];
    personalContext?: PersonalContext;
    tools: ReadonlyArray<'web_search'>;
    maxOutputTokens: number;
    maxToolCalls: number;
    signal: AbortSignal;
    onTextDelta?: (delta: string) => void;
  }): Promise<RunOutcome>;
}
