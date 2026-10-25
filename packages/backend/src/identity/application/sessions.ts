import {
  InvalidCredentialsError,
  LoginThrottledError,
} from '../domain/errors/identity.errors.js';
import type {
  ActiveSession,
  SessionLifetime,
} from '../domain/models/session.js';
import type { SessionRepository } from './ports/session.repository.js';
import type { PasswordVerifier } from './ports/password-hasher.js';
import type { SessionTokens } from './ports/session-tokens.js';

export class Sessions {
  constructor(
    private readonly repository: SessionRepository,
    private readonly passwords: PasswordVerifier,
    private readonly tokens: SessionTokens,
    private readonly lifetime: SessionLifetime,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async login(
    input: { email: string; password: string },
    previousToken: string | null,
  ) {
    const retryAfter = await this.repository.reserveLoginAttempt(this.clock());
    if (retryAfter > 0) throw new LoginThrottledError(retryAfter);
    const owner = await this.repository.findOwner();
    // Verify even for an unknown email, avoiding a cheap account-existence signal.
    const validPassword = await this.passwords.verify(
      input.password,
      owner?.passwordHash ?? null,
    );
    if (!owner || !validPassword || owner.email !== input.email) {
      throw new InvalidCredentialsError();
    }
    const now = this.clock();
    const token = this.tokens.generate();
    const expiresAt = new Date(now.getTime() + this.lifetime.absoluteMs);
    const created = await this.repository.create({
      ownerId: owner.id,
      expectedPasswordHash: owner.passwordHash,
      tokenHash: this.tokens.digest(token),
      previousTokenHash: previousToken
        ? this.tokens.digest(previousToken)
        : null,
      now,
      expiresAt,
    });
    if (!created) throw new InvalidCredentialsError();
    const session: ActiveSession = {
      owner: { id: owner.id, email: owner.email },
      expiresAt,
      idleExpiresAt: new Date(
        Math.min(expiresAt.getTime(), now.getTime() + this.lifetime.idleMs),
      ),
    };
    return { token, session };
  }

  async authenticate(token: string | null): Promise<ActiveSession | null> {
    if (!token) return null;
    return this.repository.touchActive(
      this.tokens.digest(token),
      this.clock(),
      this.lifetime.idleMs,
    );
  }

  async logout(token: string): Promise<void> {
    await this.repository.revoke(this.tokens.digest(token));
  }
}
