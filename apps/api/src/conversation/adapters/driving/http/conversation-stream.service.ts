import type { ServerResponse } from 'node:http';
import {
  ConversationError,
  ConversationLoop,
} from '@mentor/backend/conversation';
import type { Admission } from '@mentor/backend/conversation';
import { Inject, Injectable } from '@nestjs/common';
import { ConversationStream } from './conversation-stream.js';
import { describeResult } from './conversation.presenter.js';

// Owns HTTP event delivery; admission and execution rules stay in the use case.
@Injectable()
export class ConversationStreamService {
  constructor(
    @Inject(ConversationLoop)
    private readonly conversation: ConversationLoop,
  ) {}

  async submit(
    owner: string,
    command: unknown,
    response: ServerResponse,
  ): Promise<void> {
    const stream = new ConversationStream(response);
    let accepted: Admission | undefined;
    try {
      const result = await this.conversation.submit(
        owner,
        command,
        (progress) => {
          if (progress.type === 'accepted') {
            accepted = progress.admission;
            stream.write({
              type: 'accepted',
              replayed: !accepted.execute,
              ...describeResult(accepted),
            });
          } else {
            stream.write(progress);
          }
        },
      );
      stream.write({ type: 'result', ...describeResult(result) });
    } catch (error) {
      // Preserve ordinary HTTP errors until admission commits and SSE starts.
      if (!stream.started) throw error;
      if (accepted) {
        const stale =
          error instanceof ConversationError && error.code === 'STALE_HISTORY';
        stream.write({
          type: 'error',
          historyVersion: accepted.historyVersion,
          turnId: accepted.turn.id,
          attemptId: accepted.attempt.id,
          code: stale ? 'STALE_HISTORY' : 'INTERNAL_ERROR',
          message: stale
            ? 'History has changed. Reload the conversation.'
            : 'The result could not be confirmed. Check conversation history.',
        });
      }
    } finally {
      stream.close();
    }
  }
}
