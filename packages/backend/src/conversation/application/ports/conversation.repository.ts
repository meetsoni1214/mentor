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
