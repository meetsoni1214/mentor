import type { DatabaseConnection } from '../../../../../database/index.js';
import type { OwnerProvisioningRepository } from '../../../../application/ports/owner-provisioning.repository.js';
import { owners } from './owner.schema.js';

export class DrizzleOwnerRepository implements OwnerProvisioningRepository {
  constructor(private readonly db: DatabaseConnection['db']) {}

  async exists(): Promise<boolean> {
    const rows = await this.db.select({ id: owners.id }).from(owners).limit(1);
    return rows.length > 0;
  }

  async createIfAbsent(owner: {
    email: string;
    passwordHash: string;
  }): Promise<boolean> {
    const rows = await this.db
      .insert(owners)
      .values(owner)
      .onConflictDoNothing({ target: owners.singleton })
      .returning({ id: owners.id });
    return rows.length === 1;
  }
}
