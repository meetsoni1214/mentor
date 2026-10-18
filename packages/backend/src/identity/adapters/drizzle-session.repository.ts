import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { DatabaseConnection } from '../../database/database.js';
import type {
  ActiveSession,
  SessionRepository,
} from '../application/sessions.js';
import { owners } from './owner.schema.js';
import { loginThrottle, sessions } from './session.schema.js';

const attemptLimit = 5;
const windowMs = 15 * 60 * 1000;

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: DatabaseConnection['db']) {}

  async findOwner() {
    const [owner] = await this.db
      .select({
        id: owners.id,
        email: owners.email,
        passwordHash: owners.passwordHash,
      })
      .from(owners)
      .limit(1);
    return owner ?? null;
  }

  async reserveLoginAttempt(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    const [budget] = await this.db
      .insert(loginThrottle)
      .values({ attempts: 1, windowStartedAt: now })
      .onConflictDoUpdate({
        target: loginThrottle.singleton,
        set: {
          attempts: sql`case when ${loginThrottle.windowStartedAt} <= ${cutoff}::timestamptz then 1 else least(${loginThrottle.attempts} + 1, ${attemptLimit + 1}) end`,
          windowStartedAt: sql`case when ${loginThrottle.windowStartedAt} <= ${cutoff}::timestamptz then ${now.toISOString()}::timestamptz else ${loginThrottle.windowStartedAt} end`,
        },
      })
      .returning();
    if (!budget) throw new Error('Login budget unavailable');
    return budget.attempts <= attemptLimit
      ? 0
      : Math.max(
          1,
          Math.ceil(
            (budget.windowStartedAt.getTime() + windowMs - now.getTime()) /
              1000,
          ),
        );
  }

  async create(
    input: Parameters<SessionRepository['create']>[0],
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Serialize session creation with credential reset. A login that verified
      // the old password must not create a session after reset commits.
      const [owner] = await tx
        .select({ passwordHash: owners.passwordHash })
        .from(owners)
        .where(eq(owners.id, input.ownerId))
        .for('update');
      if (!owner || owner.passwordHash !== input.expectedPasswordHash)
        return false;
      await tx.delete(sessions).where(lte(sessions.expiresAt, input.now));
      if (input.previousTokenHash) {
        await tx
          .delete(sessions)
          .where(
            and(
              eq(sessions.tokenHash, input.previousTokenHash),
              eq(sessions.ownerId, input.ownerId),
            ),
          );
      }
      await tx.insert(sessions).values({
        ownerId: input.ownerId,
        tokenHash: input.tokenHash,
        createdAt: input.now,
        lastSeenAt: input.now,
        expiresAt: input.expiresAt,
      });
      return true;
    });
  }

  async touchActive(
    tokenHash: string,
    now: Date,
    idleMs: number,
  ): Promise<ActiveSession | null> {
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .update(sessions)
        .set({
          lastSeenAt: sql`greatest(${sessions.lastSeenAt}, ${now.toISOString()}::timestamptz)`,
        })
        .where(
          and(
            eq(sessions.tokenHash, tokenHash),
            gt(sessions.expiresAt, now),
            gt(sessions.lastSeenAt, new Date(now.getTime() - idleMs)),
          ),
        )
        .returning({
          ownerId: sessions.ownerId,
          expiresAt: sessions.expiresAt,
          lastSeenAt: sessions.lastSeenAt,
        });
      if (!session) return null;
      const [owner] = await tx
        .select({ id: owners.id, email: owners.email })
        .from(owners)
        .where(eq(owners.id, session.ownerId));
      if (!owner) return null;
      return {
        owner,
        expiresAt: session.expiresAt,
        idleExpiresAt: new Date(
          Math.min(
            session.expiresAt.getTime(),
            session.lastSeenAt.getTime() + idleMs,
          ),
        ),
      };
    });
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
}
