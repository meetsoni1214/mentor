import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  PersonalMemory,
  MemoryError,
} from '../../packages/backend/src/memory/index.js';
import type {
  MemoryEntry,
  MemoryRepository,
  MemoryTransactions,
} from '../../packages/backend/src/memory/index.js';

function entry(): MemoryEntry {
  return {
    id: randomUUID(),
    requestId: randomUUID(),
    text: 'Examples help.',
    sourceRequest: 'Remember that Examples help.',
    createdAt: new Date('2026-11-09T00:00:00Z'),
  };
}

function setup() {
  const repository = {
    insert: vi
      .fn<MemoryRepository['insert']>()
      .mockImplementation(async (input) => ({
        ...entry(),
        requestId: input.requestId,
        text: input.text,
        sourceRequest: input.sourceRequest,
      })),
    list: vi.fn<MemoryRepository['list']>().mockResolvedValue([]),
    get: vi.fn<MemoryRepository['get']>().mockResolvedValue(entry()),
    findByRequest: vi
      .fn<MemoryRepository['findByRequest']>()
      .mockResolvedValue(null),
  };
  const conversation = {
    hasRunningAttempt: vi
      .fn<(ownerId: string) => Promise<boolean>>()
      .mockResolvedValue(false),
  };
  const lockedOwners: string[] = [];
  const transactions: MemoryTransactions = {
    forOwner: (ownerId, operation) => {
      lockedOwners.push(ownerId);
      return operation({ memories: repository, conversation });
    },
  };
  return {
    repository,
    conversation,
    lockedOwners,
    memory: new PersonalMemory(transactions),
  };
}

const ownerId = randomUUID();
function command(sourceRequest: string) {
  return { requestId: randomUUID(), sourceRequest };
}

describe('explicit personal memory boundary', () => {
  it('resolves accepted saves while busy or full without inserting another row', async () => {
    const { memory, repository, conversation, lockedOwners } = setup();
    const saved = entry();
    repository.findByRequest.mockResolvedValue(saved);
    conversation.hasRunningAttempt.mockResolvedValue(true);
    repository.list.mockResolvedValue(Array.from({ length: 20 }, entry));
    expect(
      await memory.save(ownerId, {
        requestId: saved.requestId,
        sourceRequest: saved.sourceRequest,
      }),
    ).toEqual(saved);
    expect(repository.insert).not.toHaveBeenCalled();
    expect(conversation.hasRunningAttempt).not.toHaveBeenCalled();
    expect(lockedOwners).toEqual([ownerId]);
  });

  it('rejects changed input under an accepted request ID', async () => {
    const { memory, repository } = setup();
    const saved = entry();
    repository.findByRequest.mockResolvedValue(saved);
    await expect(
      memory.save(ownerId, {
        requestId: saved.requestId,
        sourceRequest: 'Remember that changed wording.',
      }),
    ).rejects.toEqual(new MemoryError('IDEMPOTENCY_CONFLICT'));
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('rejects new saves while conversation is running, but keeps memory readable', async () => {
    const { memory, repository, conversation } = setup();
    conversation.hasRunningAttempt.mockResolvedValue(true);
    await expect(
      memory.save(ownerId, command('Remember that examples help.')),
    ).rejects.toEqual(new MemoryError('BUSY'));
    expect(repository.insert).not.toHaveBeenCalled();
    expect(await memory.list(ownerId)).toMatchObject({ entries: [] });
  });

  it.each(['entries', 'bytes'] as const)(
    'rejects the %s limit before persistence',
    async (bound) => {
      const { memory, repository } = setup();
      const entries =
        bound === 'entries'
          ? Array.from({ length: 20 }, entry)
          : Array.from({ length: 8 }, () => ({
              ...entry(),
              text: '🌱'.repeat(128),
            }));
      repository.list.mockResolvedValue(entries);
      await expect(
        memory.save(ownerId, command('Remember that x')),
      ).rejects.toEqual(new MemoryError('LIMIT_EXCEEDED'));
      expect(repository.insert).not.toHaveBeenCalled();
    },
  );

  it('maps absent records to not found and propagates a failed insert', async () => {
    const { memory, repository } = setup();
    repository.get.mockResolvedValue(null);
    await expect(memory.get(ownerId, randomUUID())).rejects.toEqual(
      new MemoryError('NOT_FOUND'),
    );
    await expect(memory.findByRequest(ownerId, randomUUID())).rejects.toEqual(
      new MemoryError('NOT_FOUND'),
    );
    repository.insert.mockRejectedValue(
      new Error('synthetic persistence failure'),
    );
    await expect(
      memory.save(ownerId, command('Remember that examples help.')),
    ).rejects.toThrow('synthetic persistence failure');
  });

  it('preserves spelling, internal whitespace and the original direct request', async () => {
    const { memory, repository } = setup();
    const input = command('rEmEmBeR tHaT   I prefer  small\nexercises. 🌱  ');
    await memory.save(ownerId, input);
    expect(repository.insert).toHaveBeenCalledExactlyOnceWith({
      ...input,
      ownerId,
      text: 'I prefer  small\nexercises. 🌱',
    });
  });

  it.each([
    '',
    'Remember that ',
    'Remember that \n\t ',
    'Remember that\nI like examples.',
    ' Remember that I like examples.',
    'Please remember that I like examples.',
    '"Remember that I like examples."',
    '> Remember that I like examples.',
    '```\nRemember that I like examples.\n```',
    'An article says: Remember that I like examples.',
    'Actually, I prefer complete explanations.',
    `Remember that ${'a'.repeat(513)}`,
    `Remember that ${'🌱'.repeat(129)}`,
    `Remember that ${' '.repeat(1024)}x`,
    'Remember that null\0byte',
    'Remember that \ud800',
  ])('rejects unsupported or unrepresentable capture: %j', (source) => {
    const { memory, repository } = setup();
    expect(() => memory.save(ownerId, command(source))).toThrow(
      new MemoryError('INVALID_INPUT'),
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes rather than UTF-16 units at the entry boundary', async () => {
    const { memory, repository } = setup();
    await memory.save(ownerId, command(`Remember that ${'🌱'.repeat(128)}`));
    expect(repository.insert).toHaveBeenCalledOnce();
  });

  it.each([
    { requestId: 'invalid' },
    { expectedProfileVersion: 0 },
    { sourceRequest: 123 },
    { text: 'untrusted alternative payload' },
    { ownerId: randomUUID() },
  ])('rejects malformed or extra command fields: %j', (extra) => {
    const { memory, repository } = setup();
    expect(() =>
      memory.save(ownerId, {
        ...command('Remember that examples help.'),
        ...extra,
      }),
    ).toThrow(new MemoryError('INVALID_INPUT'));
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('validates and normalizes owner/request/entry identifiers on all boundaries', async () => {
    const { memory, repository } = setup();
    const id = randomUUID();
    repository.findByRequest.mockResolvedValueOnce(entry());
    await memory.get(ownerId.toUpperCase(), id.toUpperCase());
    await memory.findByRequest(ownerId, id.toUpperCase());
    expect(repository.get).toHaveBeenCalledWith(ownerId, id);
    expect(repository.findByRequest).toHaveBeenCalledWith(ownerId, id);
    for (const call of [
      () => memory.save('invalid', command('Remember that examples help.')),
      () => memory.list('invalid'),
      () => memory.get(ownerId, 'invalid'),
      () => memory.findByRequest(ownerId, 'invalid'),
    ])
      expect(call).toThrow(new MemoryError('INVALID_INPUT'));
  });
});
