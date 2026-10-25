import { eq } from 'drizzle-orm';
import type { DatabaseConnection } from '../../../../../database/database.js';
import type { OwnerPasswordResetRepository } from '../../../../application/ports/owner-password-reset.repository.js';
import { owners } from './owner.schema.js';
import { loginThrottle, sessions } from './session.schema.js';

export class DrizzleOwnerPasswordResetRepository implements OwnerPasswordResetRepository {
  constructor(private readonly db: DatabaseConnection['db']) {}

  async resetPasswordAndRevokeSessions(
    email: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [owner] = await tx
        .update(owners)
        .set({ passwordHash })
        .where(eq(owners.email, email))
        .returning({ id: owners.id });
      if (!owner) return false;
      await tx.delete(sessions).where(eq(sessions.ownerId, owner.id));
      await tx.delete(loginThrottle);
      return true;
    });
  }
}
