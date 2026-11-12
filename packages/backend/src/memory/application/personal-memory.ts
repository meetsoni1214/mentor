import { z } from 'zod';
import {
  assertProfileCapacity,
  explicitMemoryWording,
  memoryLimits,
  MemoryError,
  isForgotten,
} from '../domain/memory.js';
import type { MemoryRecord } from '../domain/memory.js';
import type { MemoryTransactions } from './ports/memory.transactions.js';

const id = z.guid().transform((value) => value.toLowerCase());
const saveInput = z.strictObject({
  requestId: id,
  sourceRequest: z.string(),
});

const mutationInput = z.strictObject({
  requestId: id,
  expectedRevision: z.number().int().positive().int(),
});
const editInput = mutationInput.extend({ sourceRequest: z.string() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MemoryError('INVALID_INPUT');

  return parsed.data;
}

export class PersonalMemory {
  constructor(private readonly transactions: MemoryTransactions) {}

  save(ownerId: string, input: unknown) {
    const owner = parse(id, ownerId);
    const command = parse(saveInput, input);
    const text = explicitMemoryWording(command.sourceRequest);

    return this.transactions.forOwner(
      owner,
      async ({ memories, conversation }) => {
        const existing = await memories.findByRequest(owner, command.requestId);
        if (existing) {
          if (isForgotten(existing)) throw new MemoryError('FORGOTTEN');
          if (existing.revision !== 1) throw new MemoryError('ENTRY_CHANGED');

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

        const saved = await memories.insert({
          ...command,
          ownerId: owner,
          text,
        });
        await conversation.startFreshContext(owner);
        return saved;
      },
    );
  }

  edit(ownerId: string, entryId: string, input: unknown) {
    const owner = parse(id, ownerId);
    const entry = parse(id, entryId);
    const command = parse(editInput, input);
    const text = explicitMemoryWording(command.sourceRequest);

    return this.transactions.forOwner(
      owner,
      async ({ memories, conversation }) => {
        const current = this.requireMemory(await memories.get(owner, entry));
        if (isForgotten(current)) throw new MemoryError('FORGOTTEN');

        if (command.requestId === current.requestId)
          throw new MemoryError('IDEMPOTENCY_CONFLICT');

        if (current.lastMutationRequestId === command.requestId) {
          if (
            current.revision !== command.expectedRevision + 1 ||
            current.sourceRequest !== command.sourceRequest
          )
            throw new MemoryError('IDEMPOTENCY_CONFLICT');

          return current;
        }

        if (current.revision !== command.expectedRevision)
          throw new MemoryError('ENTRY_CHANGED');
        if (await conversation.hasRunningAttempt(owner))
          throw new MemoryError('BUSY');

        const entries = await memories.list(owner);
        assertProfileCapacity(
          entries
            .filter((value) => value.id !== entry)
            .map((value) => value.text),
          text,
        );

        const saved = await memories.edit({
          ...command,
          ownerId: owner,
          entryId: entry,
          text,
        });
        await conversation.startFreshContext(owner);
        return saved;
      },
    );
  }

  forget(ownerId: string, entryId: string, input: unknown) {
    const owner = parse(id, ownerId);
    const entry = parse(id, entryId);
    const command = parse(mutationInput, input);

    return this.transactions.forOwner(
      owner,
      async ({ memories, conversation }) => {
        const current = this.requireMemory(await memories.get(owner, entry));
        if (isForgotten(current)) return current;

        if (
          command.requestId === current.requestId ||
          command.requestId === current.lastMutationRequestId
        )
          throw new MemoryError('IDEMPOTENCY_CONFLICT');
        if (current.revision !== command.expectedRevision)
          throw new MemoryError('ENTRY_CHANGED');
        if (await conversation.hasRunningAttempt(owner))
          throw new MemoryError('BUSY');

        const forgotten = await memories.forget({
          ...command,
          ownerId: owner,
          entryId: entry,
        });
        await conversation.startFreshContext(owner);
        return forgotten;
      },
    );
  }

  list(ownerId: string) {
    const owner = parse(id, ownerId);

    return this.transactions.forOwner(owner, async ({ memories }) => ({
      limits: memoryLimits,
      entries: await memories.list(owner),
    }));
  }

  get(ownerId: string, entryId: string) {
    const owner = parse(id, ownerId);
    const entry = parse(id, entryId);

    return this.transactions.forOwner(owner, async ({ memories }) =>
      this.requireMemory(await memories.get(owner, entry)),
    );
  }

  findByRequest(ownerId: string, requestId: string) {
    const owner = parse(id, ownerId);
    const request = parse(id, requestId);

    return this.transactions.forOwner(owner, async ({ memories }) =>
      this.requireMemory(await memories.findByRequest(owner, request)),
    );
  }

  private requireMemory(entry: MemoryRecord | null): MemoryRecord {
    if (!entry) throw new MemoryError('NOT_FOUND');

    return entry;
  }
}
