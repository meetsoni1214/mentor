export interface OwnerProvisioningRepository {
  exists(): Promise<boolean>;
  createIfAbsent(owner: {
    email: string;
    passwordHash: string;
  }): Promise<boolean>;
}
