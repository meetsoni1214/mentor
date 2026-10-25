import { OwnerNotFoundError } from '../domain/errors/identity.errors.js';
import { loginCredentials } from './credentials.js';
import type { OwnerPasswordResetRepository } from './ports/owner-password-reset.repository.js';
import type { PasswordHasher } from './ports/password-hasher.js';

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
