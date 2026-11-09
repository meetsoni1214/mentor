import type { MemoryEntry } from '@mentor/backend/memory';
import type { MemoryEntryDto } from './memory.dto.js';

export function describeMemoryEntry(entry: MemoryEntry): MemoryEntryDto {
  return { ...entry, createdAt: entry.createdAt.toISOString() };
}
