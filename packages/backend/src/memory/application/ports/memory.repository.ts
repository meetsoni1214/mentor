import type { MemoryEntry } from '../../domain/memory.js';
import type { SaveMemory } from '../memory.contracts.js';

export interface MemoryRepository {
  insert(command: SaveMemory): Promise<MemoryEntry>;
  list(ownerId: string): Promise<MemoryEntry[]>;
  get(ownerId: string, entryId: string): Promise<MemoryEntry | null>;
  findByRequest(
    ownerId: string,
    requestId: string,
  ): Promise<MemoryEntry | null>;
}
