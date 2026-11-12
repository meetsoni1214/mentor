import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../database/index.js';
import type {
  MemoryEntry,
  MemoryRecord,
  ForgottenMemory,
} from '../domain/memory.js';
import type {
  SaveMemory,
  EditMemory,
  ForgetMemory,
} from '../application/memory.contracts.js';
import type { MemoryRepository } from '../application/ports/memory.repository.js';
import { memories } from './memory.schema.js';

const entryColumns = {
  id: memories.id,
  requestId: memories.requestId,
  text: memories.text,
  sourceRequest: memories.sourceRequest,
  createdAt: memories.createdAt,
  revision: memories.revision,
  lastMutationRequestId: memories.lastMutationRequestId,
  forgottenAt: memories.forgottenAt,
};
type StoredMemory = Pick<
  typeof memories.$inferSelect,
  keyof typeof entryColumns
>;
function record(row: StoredMemory): MemoryRecord {
  if (row.forgottenAt)
    return {
      state: 'forgotten',
      id: row.id,
      requestId: row.requestId,
      revision: row.revision,
      lastMutationRequestId: row.lastMutationRequestId,
      forgottenAt: row.forgottenAt,
    };
  if (row.text === null || row.sourceRequest === null)
    throw new Error('Invalid memory content state');
  return {
    id: row.id,
    requestId: row.requestId,
    text: row.text,
    sourceRequest: row.sourceRequest,
    createdAt: row.createdAt,
    revision: row.revision,
    lastMutationRequestId: row.lastMutationRequestId,
  };
}
function active(row: StoredMemory | undefined): MemoryEntry {
  if (!row) throw new Error('Memory unavailable');
  const value = record(row);
  if ('state' in value) throw new Error('Memory is not active');
  return value;
}
export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}
  async insert(input: SaveMemory): Promise<MemoryEntry> {
    const [saved] = await this.transaction
      .insert(memories)
      .values(input)
      .returning(entryColumns);
    return active(saved);
  }
  async list(ownerId: string): Promise<MemoryEntry[]> {
    const rows = await this.transaction
      .select(entryColumns)
      .from(memories)
      .where(and(eq(memories.ownerId, ownerId), isNull(memories.forgottenAt)))
      .orderBy(asc(memories.createdAt), asc(memories.id));
    return rows.map(active);
  }
  async get(ownerId: string, entryId: string): Promise<MemoryRecord | null> {
    const [entry] = await this.transaction
      .select(entryColumns)
      .from(memories)
      .where(and(eq(memories.ownerId, ownerId), eq(memories.id, entryId)));
    return entry ? record(entry) : null;
  }
  async findByRequest(
    ownerId: string,
    requestId: string,
  ): Promise<MemoryRecord | null> {
    const [entry] = await this.transaction
      .select(entryColumns)
      .from(memories)
      .where(
        and(eq(memories.ownerId, ownerId), eq(memories.requestId, requestId)),
      );
    return entry ? record(entry) : null;
  }
  async edit(input: EditMemory): Promise<MemoryEntry> {
    const [saved] = await this.transaction
      .update(memories)
      .set({
        text: input.text,
        sourceRequest: input.sourceRequest,
        revision: sql`${memories.revision} + 1`,
        lastMutationRequestId: input.requestId,
      })
      .where(
        and(
          eq(memories.ownerId, input.ownerId),
          eq(memories.id, input.entryId),
          eq(memories.revision, input.expectedRevision),
          isNull(memories.forgottenAt),
        ),
      )
      .returning(entryColumns);
    return active(saved);
  }
  async forget(input: ForgetMemory): Promise<ForgottenMemory> {
    const [saved] = await this.transaction
      .update(memories)
      .set({
        text: null,
        sourceRequest: null,
        forgottenAt: sql`clock_timestamp()`,
        revision: sql`${memories.revision} + 1`,
        lastMutationRequestId: input.requestId,
      })
      .where(
        and(
          eq(memories.ownerId, input.ownerId),
          eq(memories.id, input.entryId),
          eq(memories.revision, input.expectedRevision),
          isNull(memories.forgottenAt),
        ),
      )
      .returning(entryColumns);
    if (!saved) throw new Error('Memory unavailable');
    const value = record(saved);
    if (!('state' in value)) throw new Error('Memory was not forgotten');
    return value;
  }
}
