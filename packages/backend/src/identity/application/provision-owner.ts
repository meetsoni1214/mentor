import { OwnerAlreadyExistsError } from '../domain/errors/identity.errors.js';
import type { OwnerProvisioningRepository } from './ports/owner-provisioning.repository.js';
import type { PasswordHasher } from './ports/password-hasher.js';

export class ProvisionOwner {
  constructor(
    private readonly owners: OwnerProvisioningRepository,
    private readonly passwords: PasswordHasher,
  ) {}

  async execute(input: { email: string; password: string }): Promise<void> {
    if (await this.owners.exists()) {
      throw new OwnerAlreadyExistsError();
    }
    const passwordHash = await this.passwords.hash(input.password);
    const created = await this.owners.createIfAbsent({
      email: input.email,
      passwordHash,
    });
    // A second process may have provisioned the owner while hashing ran.
    if (!created) {
      throw new OwnerAlreadyExistsError();
    }
  }
}
