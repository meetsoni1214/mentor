export interface OwnerProvisioningRepository {
  exists(): Promise<boolean>;
  createIfAbsent(owner: {
    email: string;
    passwordHash: string;
  }): Promise<boolean>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

export class OwnerAlreadyExistsError extends Error {
  constructor() {
    super('An owner already exists. This command never replaces credentials.');
  }
}

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
