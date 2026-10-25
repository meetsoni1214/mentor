import type { RunAttempt, RunOutcome } from '../../domain/conversation.js';
import type {
  Admission,
  AttemptReference,
  CompletedTurn,
  ConversationHistory,
  HistoryCursor,
  RetryRequest,
  RunLimits,
  Submission,
} from '../conversation.contracts.js';

export interface ConversationRepository {
  submit(input: Submission, limits: RunLimits): Promise<Admission>;
  retry(input: RetryRequest, limits: RunLimits): Promise<Admission>;
  finish(
    ref: AttemptReference,
    outcome: RunOutcome,
  ): Promise<RunAttempt | null>;
  // Newest completed pairs first, with one extra pair beyond the 100-pair cap
  // so selection can report that older context was omitted.
  context(
    ref: AttemptReference,
    beforeSequence: number,
  ): Promise<CompletedTurn[]>;
  history(
    ownerId: string,
    options?: { cursor?: HistoryCursor; limit?: number },
  ): Promise<ConversationHistory>;
  clear(ownerId: string, expectedVersion: number): Promise<number>;
}
