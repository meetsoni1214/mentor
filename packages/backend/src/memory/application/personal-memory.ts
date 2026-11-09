import { z } from 'zod';
import {
  assertProfileCapacity,
  explicitMemoryWording,
  memoryLimits,
  MemoryError,
} from '../domain/memory.js';
import type { MemoryEntry } from '../domain/memory.js';
import type { MemoryTransactions } from './ports/memory.transactions.js';

const id = z.guid().transform((value) => value.toLowerCase());
const saveInput = z.strictObject({
  requestId: id,
  sourceRequest: z.string(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MemoryError('INVALID_INPUT');
  return parsed.data;
}

export class PersonalMemory {
  constructor(private readonly transactions: MemoryTransactions) {}

  save(ownerId: unknown, input: unknown) {
    const owner = parse(id, ownerId);
    const command = parse(saveInput, input);
    const text = explicitMemoryWording(command.sourceRequest);
    return this.transactions.forOwner(
      owner,
      async ({ memories, conversation }) => {
        const existing = await memories.findByRequest(owner, command.requestId);
        if (existing) {
          if (
            existing.sourceRequest !== command.sourceRequest ||
            existing.text !== text
          )
            throw new MemoryError('IDEMPOTENCY_CONFLICT');
          return existing;
        }
        if (await conversation.hasRunningAttempt(owner))
          throw new MemoryError('BUSY');
        const current = await memories.list(owner);
        assertProfileCapacity(
          current.map((entry) => entry.text),
          text,
        );
        return memories.insert({ ...command, ownerId: owner, text });
      },
    );
  }

  list(ownerId: unknown) {
    const owner = parse(id, ownerId);
    return this.transactions.forOwner(owner, async ({ memories }) => ({
      limits: memoryLimits,
      entries: await memories.list(owner),
    }));
  }

  get(ownerId: unknown, entryId: unknown) {
    const owner = parse(id, ownerId);
    const entry = parse(id, entryId);
    return this.transactions.forOwner(owner, async ({ memories }) =>
      this.requireMemory(await memories.get(owner, entry)),
    );
  }

  findByRequest(ownerId: unknown, requestId: unknown) {
    const owner = parse(id, ownerId);
    const request = parse(id, requestId);
    return this.transactions.forOwner(owner, async ({ memories }) =>
      this.requireMemory(await memories.findByRequest(owner, request)),
    );
  }

  private requireMemory(entry: MemoryEntry | null): MemoryEntry {
    if (!entry) throw new MemoryError('NOT_FOUND');
    return entry;
  }
}
