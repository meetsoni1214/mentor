import type {
  MemoryEntry,
  MemoryRecord,
  ForgottenMemory,
} from '../../domain/memory.js';
import type {
  SaveMemory,
  EditMemory,
  ForgetMemory,
} from '../memory.contracts.js';

export interface MemoryRepository {
  insert(command: SaveMemory): Promise<MemoryEntry>;
  edit(command: EditMemory): Promise<MemoryEntry>;
  forget(command: ForgetMemory): Promise<ForgottenMemory>;
  list(ownerId: string): Promise<MemoryEntry[]>;
  get(ownerId: string, entryId: string): Promise<MemoryRecord | null>;
  findByRequest(
    ownerId: string,
    requestId: string,
  ): Promise<MemoryRecord | null>;
}
