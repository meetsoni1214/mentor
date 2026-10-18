import type { PasswordHasher } from './provision-owner.js';
import { loginCredentials } from './credentials.js';

export interface OwnerPasswordResetRepository {
  resetPasswordAndRevokeSessions(
    email: string,
    passwordHash: string,
  ): Promise<boolean>;
}

export class OwnerNotFoundError extends Error {
  constructor() {
    super(
      'No owner matches that email. Check the email or run pnpm owner:create for initial setup.',
    );
  }
}

export class ResetOwnerPassword {
  constructor(
    private readonly owners: OwnerPasswordResetRepository,
    private readonly passwords: PasswordHasher,
  ) {}

  async execute(input: { email: string; password: string }): Promise<void> {
    const credentials = loginCredentials.parse(input);
    const hash = await this.passwords.hash(credentials.password);
    if (
      !(await this.owners.resetPasswordAndRevokeSessions(
        credentials.email,
        hash,
      ))
    ) {
      throw new OwnerNotFoundError();
    }
  }
}
