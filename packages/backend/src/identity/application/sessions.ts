export interface OwnerCredentials {
  id: string;
  email: string;
  passwordHash: string;
}

export interface ActiveSession {
  owner: { id: string; email: string };
  expiresAt: Date;
  idleExpiresAt: Date;
}

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

export interface PasswordVerifier {
  verify(password: string, hash: string | null): Promise<boolean>;
}

export interface SessionTokens {
  generate(): string;
  digest(token: string): string;
}

export class InvalidCredentialsError extends Error {}
export class LoginThrottledError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many sign-in attempts.');
  }
}

export class Sessions {
  constructor(
    private readonly repository: SessionRepository,
    private readonly passwords: PasswordVerifier,
    private readonly tokens: SessionTokens,
    private readonly lifetime: { idleMs: number; absoluteMs: number },
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
