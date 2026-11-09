import type { MemoryEntry, memoryLimits } from '../domain/memory.js';

export interface SaveMemory {
  ownerId: string;
  requestId: string;
  sourceRequest: string;
  text: string;
}

export interface MemorySnapshot {
  limits: typeof memoryLimits;
  entries: MemoryEntry[];
}
