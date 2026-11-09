import { ConversationActivity } from '@mentor/backend/conversation';
import { DrizzleConversationActivityReader } from '@mentor/backend/conversation/persistence';
import type { DatabaseConnection } from '@mentor/backend/database';
import { lockOwnerForUpdate } from '@mentor/backend/identity/persistence';
import { MemoryError, PersonalMemory } from '@mentor/backend/memory';
import { DrizzleMemoryRepository } from '@mentor/backend/memory/persistence';

export function createPersonalMemory(
  db: DatabaseConnection['db'],
): PersonalMemory {
  return new PersonalMemory({
    forOwner: (ownerId, operation) =>
      db.transaction(async (transaction) => {
        if (!(await lockOwnerForUpdate(transaction, ownerId)))
          throw new MemoryError('NOT_FOUND');
        return operation({
          memories: new DrizzleMemoryRepository(transaction),
          conversation: new ConversationActivity(
            new DrizzleConversationActivityReader(transaction),
          ),
        });
      }),
  });
}
