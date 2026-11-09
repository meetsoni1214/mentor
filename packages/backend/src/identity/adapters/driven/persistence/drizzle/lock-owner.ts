import { eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../../../../database/index.js';
import { owners } from './owner.schema.js';

export async function lockOwnerForUpdate(
  transaction: DatabaseTransaction,
  ownerId: string,
): Promise<boolean> {
  const [owner] = await transaction
    .select({ id: owners.id })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .for('update');
  return owner !== undefined;
}
