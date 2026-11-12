import type { MemoryRepository } from './memory.repository.js';

export interface MemoryTransactionScope {
  memories: MemoryRepository;
  conversation: {
    hasRunningAttempt(ownerId: string): Promise<boolean>;
    startFreshContext(ownerId: string): Promise<void>;
  };
}

export interface MemoryTransactions {
  // Every supplied capability shares one transaction. Hold the existing owner's
  // lock until commit/rollback, and resolve success only after commit.
  forOwner<T>(
    ownerId: string,
    operation: (scope: MemoryTransactionScope) => Promise<T>,
  ): Promise<T>;
}
