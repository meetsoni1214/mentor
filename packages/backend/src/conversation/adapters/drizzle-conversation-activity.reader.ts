import { and, eq, gt, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../database/index.js';
import type { ConversationActivityReader } from '../application/ports/conversation-activity.reader.js';
import { conversationAttempts, conversations } from './conversation.schema.js';

export class DrizzleConversationActivityReader implements ConversationActivityReader {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async startFreshContext(ownerId: string): Promise<void> {
    await this.transaction
      .update(conversations)
      .set({ contextStartSequence: conversations.nextSequence })
      .where(eq(conversations.ownerId, ownerId));
  }

  async hasUnexpiredRunningAttempt(ownerId: string): Promise<boolean> {
    const [attempt] = await this.transaction
      .select({ id: conversationAttempts.id })
      .from(conversationAttempts)
      .innerJoin(
        conversations,
        eq(conversations.id, conversationAttempts.conversationId),
      )
      .where(
        and(
          eq(conversations.ownerId, ownerId),
          eq(conversationAttempts.state, 'running'),
          gt(conversationAttempts.deadlineAt, sql`clock_timestamp()`),
        ),
      )
      .limit(1);
    return attempt !== undefined;
  }
}
