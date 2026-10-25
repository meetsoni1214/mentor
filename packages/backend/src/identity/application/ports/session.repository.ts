import type { OwnerCredentials } from '../../domain/models/owner.js';
import type { ActiveSession } from '../../domain/models/session.js';

export interface SessionRepository {
  findOwner(): Promise<OwnerCredentials | null>;
  reserveLoginAttempt(now: Date): Promise<number>;
  create(input: {
    ownerId: string;
    expectedPasswordHash: string;
    tokenHash: string;
    previousTokenHash: string | null;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean>;
  touchActive(
    tokenHash: string,
    now: Date,
    idleMs: number,
  ): Promise<ActiveSession | null>;
  revoke(tokenHash: string): Promise<void>;
}
