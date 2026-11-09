import { and, asc, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../database/index.js';
import type { MemoryEntry } from '../domain/memory.js';
import type { SaveMemory } from '../application/memory.contracts.js';
import type { MemoryRepository } from '../application/ports/memory.repository.js';
import { memories } from './memory.schema.js';

const entryColumns = {
  id: memories.id,
  requestId: memories.requestId,
  text: memories.text,
  sourceRequest: memories.sourceRequest,
  createdAt: memories.createdAt,
};

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async insert(input: SaveMemory): Promise<MemoryEntry> {
    const [saved] = await this.transaction
      .insert(memories)
      .values(input)
      .returning(entryColumns);
    if (!saved) throw new Error('Memory unavailable');
    return saved;
  }

  list(ownerId: string): Promise<MemoryEntry[]> {
    return this.transaction
      .select(entryColumns)
      .from(memories)
      .where(eq(memories.ownerId, ownerId))
      .orderBy(asc(memories.createdAt), asc(memories.id));
  }

  async get(ownerId: string, entryId: string): Promise<MemoryEntry | null> {
    const [entry] = await this.transaction
      .select(entryColumns)
      .from(memories)
      .where(and(eq(memories.ownerId, ownerId), eq(memories.id, entryId)));
    return entry ?? null;
  }

  async findByRequest(
    ownerId: string,
    requestId: string,
  ): Promise<MemoryEntry | null> {
    const [entry] = await this.transaction
      .select(entryColumns)
      .from(memories)
      .where(
        and(eq(memories.ownerId, ownerId), eq(memories.requestId, requestId)),
      );
    return entry ?? null;
  }
}
