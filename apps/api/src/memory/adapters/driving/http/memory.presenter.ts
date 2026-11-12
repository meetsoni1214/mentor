import type {
  MemoryEntry,
  MemoryRecord,
  ForgottenMemory,
} from '@mentor/backend/memory';
import type { MemoryEntryDto, ForgottenMemoryDto } from './memory.dto.js';

export function describeMemoryEntry(entry: MemoryEntry): MemoryEntryDto {
  return { ...entry, createdAt: entry.createdAt.toISOString() };
}
export function describeForgottenMemory(
  entry: ForgottenMemory,
): ForgottenMemoryDto {
  return { ...entry, forgottenAt: entry.forgottenAt.toISOString() };
}
export function describeMemoryRecord(
  entry: MemoryRecord,
): MemoryEntryDto | ForgottenMemoryDto {
  return 'state' in entry
    ? describeForgottenMemory(entry)
    : describeMemoryEntry(entry);
}
