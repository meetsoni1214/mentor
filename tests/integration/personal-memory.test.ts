import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@mentor/backend/database';
import { readDatabaseEnvironment } from '@mentor/backend/config';
import { MemoryError, memoryLimits } from '@mentor/backend/memory';
import { createPersonalMemory } from '../../apps/api/src/memory/infrastructure/create-personal-memory.js';
import { DrizzleConversationRepository } from '@mentor/backend/conversation/persistence';
import type { Admission, RunLimits } from '@mentor/backend/conversation';
import type { MemoryEntry } from '@mentor/backend/memory';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test')
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const memory = createPersonalMemory(connection.db);
const conversation = new DrizzleConversationRepository(connection.db);
let ownerId: string;
let otherOwnerId: string;

const limits: RunLimits = {
  model: 'synthetic-memory-model',
  allowedTools: ['web_search'],
  deadlineMs: 60000,
  maxMessageBytes: 8192,
  maxContextBytes: 32768,
  maxOutputTokens: 512,
  maxToolCalls: 1,
};

function command(text = 'I prefer  small\nexercises. 🌱') {
  return { requestId: randomUUID(), sourceRequest: `Remember that ${text}` };
}

async function countMemories() {
  const result = await connection.pool.query<{ count: number }>(
    'select count(*)::int as count from memories',
  );
  return result.rows[0]?.count;
}

beforeAll(async () => {
  await migrateDatabase(connection);
});
beforeEach(async () => {
  await connection.pool.query('truncate owners, login_throttle cascade');
  const result = await connection.pool.query<{ id: string }>(
    "insert into owners (email,password_hash) values ('memory@example.test','synthetic') returning id",
  );
  ownerId = result.rows[0]!.id;
  otherOwnerId = randomUUID();
});
afterAll(async () => {
  await connection.pool.end();
});

describe('durable explicit memory', () => {
  it('keeps one memory table with content-free recovery metadata', async () => {
    const tables = await connection.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and (table_name='memories' or table_name like 'memory_%' or table_name='owner_memory_state') order by table_name",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(['memories']);
    const columns = await connection.pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='memories' order by ordinal_position",
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'owner_id',
      'request_id',
      'text',
      'source_request',
      'created_at',
      'revision',
      'last_mutation_request_id',
      'forgotten_at',
    ]);
  });

  it('reads empty state without creating rows and saves independently of conversation', async () => {
    expect(await memory.list(ownerId)).toEqual({
      limits: memoryLimits,
      entries: [],
    });
    expect(await countMemories()).toBe(0);
    await memory.save(ownerId, command());
    expect(
      (await connection.pool.query('select * from conversations')).rows,
    ).toEqual([]);
    await expect(memory.list(randomUUID())).rejects.toEqual(
      new MemoryError('NOT_FOUND'),
    );
  });

  it('commits exact wording/source/request in one row and recovers through a new connection', async () => {
    const input = command();
    const saved = await memory.save(ownerId, input);
    expect(saved).toEqual({
      revision: 1,
      lastMutationRequestId: null,
      id: expect.any(String),
      requestId: input.requestId,
      text: 'I prefer  small\nexercises. 🌱',
      sourceRequest: input.sourceRequest,
      createdAt: expect.any(Date),
    });
    expect(await countMemories()).toBe(1);
    const reopened = createDatabase(
      readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
    );
    try {
      const restarted = createPersonalMemory(reopened.db);
      expect(await restarted.findByRequest(ownerId, input.requestId)).toEqual(
        saved,
      );
      expect(await restarted.get(ownerId, saved.id)).toEqual(saved);
    } finally {
      await reopened.pool.end();
    }
  });

  it('serializes duplicate saves and returns a saved replay before busy checks', async () => {
    const input = command();
    const [first, second] = await Promise.all([
      memory.save(ownerId, input),
      memory.save(ownerId, input),
    ]);
    expect(second).toEqual(first);
    await memory.save(ownerId, command('Another explicit decision.'));
    await conversation.submit(
      {
        ownerId,
        historyVersion: 0,
        requestId: randomUUID(),
        text: 'An unrelated running question.',
      },
      limits,
    );
    expect(await memory.save(ownerId, input)).toEqual(first);
    expect(await memory.findByRequest(ownerId, input.requestId)).toEqual(first);
    expect(await countMemories()).toBe(2);
  });

  it('rejects changed accepted wording or source spelling without creating a row', async () => {
    const input = command();
    await memory.save(ownerId, input);
    for (const sourceRequest of [
      'Remember that a different preference.',
      input.sourceRequest.replace('Remember', 'REMEMBER'),
    ])
      await expect(
        memory.save(ownerId, { ...input, sourceRequest }),
      ).rejects.toEqual(new MemoryError('IDEMPOTENCY_CONFLICT'));
    expect(await countMemories()).toBe(1);
  });

  it('accepts independent concurrent saves without profile versions or semantic deduplication', async () => {
    const first = command();
    const second = command();
    const saved = await Promise.all([
      memory.save(ownerId, first),
      memory.save(ownerId, second),
    ]);
    expect(saved[0]?.id).not.toBe(saved[1]?.id);
    expect(await countMemories()).toBe(2);
  });

  it('rejects unknown owners and keeps replaced owner scopes separate under the singleton constraint', async () => {
    const input = command();
    const saved = await memory.save(ownerId, input);
    for (const lookup of [
      () => memory.get(otherOwnerId, saved.id),
      () => memory.findByRequest(otherOwnerId, input.requestId),
      () => memory.list(otherOwnerId),
      () => memory.save(otherOwnerId, input),
    ])
      await expect(lookup()).rejects.toEqual(new MemoryError('NOT_FOUND'));
    // A second simultaneous owner is intentionally impossible. Replace the
    // singleton through test-only SQL to exercise a different valid scope.
    await connection.pool.query('delete from owners where id=$1', [ownerId]);
    await connection.pool.query(
      "insert into owners(id,email,password_hash) values($1,'replacement@example.test','synthetic')",
      [otherOwnerId],
    );
    await expect(memory.get(otherOwnerId, saved.id)).rejects.toEqual(
      new MemoryError('NOT_FOUND'),
    );
    await expect(
      memory.findByRequest(otherOwnerId, input.requestId),
    ).rejects.toEqual(new MemoryError('NOT_FOUND'));
    const separate = await memory.save(otherOwnerId, input);
    expect(separate.id).not.toBe(saved.id);
  });

  it.each(['entries', 'bytes'] as const)(
    'enforces the %s limit and still resolves a prior save',
    async (bound) => {
      const maximum = bound === 'entries' ? 20 : 8;
      const text = bound === 'entries' ? 'x' : '🌱'.repeat(128);
      const firstInput = command(text);
      const first = await memory.save(ownerId, firstInput);
      for (let index = 1; index < maximum; index++)
        await memory.save(ownerId, command(text));
      const rejected = command('x');
      await expect(memory.save(ownerId, rejected)).rejects.toEqual(
        new MemoryError('LIMIT_EXCEEDED'),
      );
      await expect(
        memory.findByRequest(ownerId, rejected.requestId),
      ).rejects.toEqual(new MemoryError('NOT_FOUND'));
      expect(await countMemories()).toBe(maximum);
      expect(await memory.save(ownerId, firstInput)).toEqual(first);
    },
  );

  it('leaves no saved row after a persistence failure and permits an explicit retry', async () => {
    const input = command();
    await connection.pool.query(
      "create function reject_memory_save() returns trigger language plpgsql as $$ begin raise exception 'synthetic persistence failure'; end $$",
    );
    try {
      await connection.pool.query(
        'create trigger reject_memory_save after insert on memories for each row execute function reject_memory_save()',
      );
      await expect(memory.save(ownerId, input)).rejects.toThrow();
      expect(await countMemories()).toBe(0);
      await expect(
        memory.findByRequest(ownerId, input.requestId),
      ).rejects.toEqual(new MemoryError('NOT_FOUND'));
    } finally {
      await connection.pool.query(
        'drop trigger if exists reject_memory_save on memories',
      );
      await connection.pool.query('drop function reject_memory_save()');
    }
    expect((await memory.save(ownerId, input)).requestId).toBe(input.requestId);
  });

  it('shares the database owner lock with admission from another connection', async () => {
    const input = command();
    const client = await connection.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('begin');
      await client.query('select id from owners where id=$1 for update', [
        ownerId,
      ]);
      // Capture rejection immediately, avoiding an unhandled promise while the
      // separate transaction is publishing a running attempt under the lock.
      pending = memory.save(ownerId, input).catch((error: unknown) => error);
      const created = await client.query<{ id: string }>(
        'insert into conversations(owner_id) values($1) returning id',
        [ownerId],
      );
      const conversationId = created.rows[0]!.id;
      const turn = await client.query<{ id: string }>(
        "insert into conversation_turns(conversation_id,request_id,sequence,text) values($1,$2,1,'synthetic') returning id",
        [conversationId, randomUUID()],
      );
      await client.query(
        "insert into conversation_attempts(conversation_id,turn_id,request_id,model,state,started_at,deadline_at) values($1,$2,$3,'synthetic','running',clock_timestamp(),clock_timestamp()+interval '60 seconds')",
        [conversationId, turn.rows[0]!.id, randomUUID()],
      );
      await client.query('commit');
      expect(await pending).toEqual(new MemoryError('BUSY'));
      expect(await countMemories()).toBe(0);
    } finally {
      await client.query('rollback');
      client.release();
      await pending;
    }
  });

  it('allows reads while busy, ignores expired attempts and prevents their late completion', async () => {
    const saved = await memory.save(ownerId, command());
    const admitted = await conversation.submit(
      {
        ownerId,
        historyVersion: 0,
        requestId: randomUUID(),
        text: 'Synthetic running question',
      },
      limits,
    );
    await expect(memory.save(ownerId, command())).rejects.toEqual(
      new MemoryError('BUSY'),
    );
    expect(await memory.get(ownerId, saved.id)).toEqual(saved);
    await connection.pool.query(
      "update conversation_attempts set started_at=clock_timestamp()-interval '2 seconds',deadline_at=clock_timestamp()-interval '1 second' where id=$1",
      [admitted.attempt.id],
    );
    await memory.save(ownerId, command());
    const late = await conversation.finish(
      { ownerId, historyVersion: 0, attemptId: admitted.attempt.id },
      {
        state: 'completed',
        answer: 'Obsolete answer',
        sources: [],
        activity: [],
        usage: null,
        contextLimited: false,
      },
    );
    expect(late?.state).toBe('interrupted');
    expect(late?.answer).toBeNull();
  });

  it('holds the owner lock from activity checking through save commit while admission waits', async () => {
    const blocker = await connection.pool.connect();
    const otherConnection = createDatabase(
      readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
    );
    const otherConversation = new DrizzleConversationRepository(
      otherConnection.db,
    );
    const advisoryKey = 20261109;
    let save: Promise<MemoryEntry> | undefined;
    let admission: Promise<Admission> | undefined;

    async function waitForDatabaseCondition(
      query: string,
      parameters: unknown[],
    ) {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const result = await connection.pool.query<{ pid: number }>(
          query,
          parameters,
        );
        const row = result.rows[0];
        if (row) return row;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Expected database lock wait was not observed');
    }

    try {
      await blocker.query('select pg_advisory_lock($1)', [advisoryKey]);
      await connection.pool
        .query(`create function pause_memory_insert() returns trigger language plpgsql as $$
        begin perform pg_advisory_xact_lock(${advisoryKey}); return new; end $$`);
      await connection.pool.query(
        'create trigger pause_memory_insert before insert on memories for each row execute function pause_memory_insert()',
      );

      // The trigger pauses after the service's activity read, with the save's
      // transaction still open. No process-local hooks or timing guesses.
      save = memory.save(ownerId, command());
      void save.catch(() => {});
      const waitingSave = await waitForDatabaseCondition(
        "select pid from pg_locks where locktype='advisory' and objid=$1 and not granted",
        [advisoryKey],
      );
      admission = otherConversation.submit(
        {
          ownerId,
          historyVersion: 0,
          requestId: randomUUID(),
          text: 'Question admitted after the memory save.',
        },
        limits,
      );
      void admission.catch(() => {});
      await waitForDatabaseCondition(
        "select pid from pg_stat_activity where wait_event_type='Lock' and $1 = any(pg_blocking_pids(pid))",
        [waitingSave.pid],
      );
      expect(
        (await connection.pool.query('select * from conversation_attempts'))
          .rows,
      ).toEqual([]);
      await blocker.query('select pg_advisory_unlock($1)', [advisoryKey]);
      const saved = await save;
      const accepted = await admission;
      expect(await memory.get(ownerId, saved.id)).toEqual(saved);
      expect(accepted.execute).toBe(true);
      expect(accepted.attempt.state).toBe('running');
    } finally {
      await blocker.query('select pg_advisory_unlock($1)', [advisoryKey]);
      await Promise.allSettled([save, admission]);
      await connection.pool.query(
        'drop trigger if exists pause_memory_insert on memories',
      );
      await connection.pool.query(
        'drop function if exists pause_memory_insert()',
      );
      blocker.release();
      await otherConnection.pool.end();
    }
  });

  it('keeps memory and direct-request provenance when history is cleared', async () => {
    const input = command();
    const saved = await memory.save(ownerId, input);
    await conversation.clear(ownerId, 0);
    expect(await memory.findByRequest(ownerId, input.requestId)).toEqual(saved);
    expect(await memory.get(ownerId, saved.id)).toMatchObject({
      sourceRequest: input.sourceRequest,
    });
  });

  it('enforces ownership, UTF-8 bounds and unique request IDs in PostgreSQL', async () => {
    const saved = await memory.save(ownerId, command());
    const statements: [string, unknown[], string][] = [
      [
        'update memories set text=$1 where id=$2',
        ['🌱'.repeat(129), saved.id],
        '23514',
      ],
      [
        'update memories set source_request=$1 where id=$2',
        ['x'.repeat(1025), saved.id],
        '23514',
      ],
      [
        'update memories set owner_id=$1 where id=$2',
        [otherOwnerId, saved.id],
        '23503',
      ],
      [
        'insert into memories(owner_id,request_id,text,source_request) values($1,$2,$3,$4)',
        [ownerId, saved.requestId, saved.text, saved.sourceRequest],
        '23505',
      ],
    ];
    for (const [query, parameters, code] of statements)
      await expect(
        connection.pool.query(query, parameters),
      ).rejects.toMatchObject({ code });
  });
});

describe('memory correction and forgetting', () => {
  const edit = (revision: number, text = 'I prefer explanations first.') => ({
    ...command(text),
    expectedRevision: revision,
  });
  const forget = (revision: number) => ({
    requestId: randomUUID(),
    expectedRevision: revision,
  });

  it('replaces wording/source, recovers the latest edit, and rejects older save/edit/delete requests', async () => {
    const initial = command('Old synthetic preference');
    const saved = await memory.save(ownerId, initial);
    const first = edit(saved.revision);
    const changed = await memory.edit(ownerId, saved.id, first);
    expect(changed).toMatchObject({
      revision: 2,
      sourceRequest: first.sourceRequest,
      lastMutationRequestId: first.requestId,
    });
    expect(await memory.edit(ownerId, saved.id, first)).toEqual(changed);
    await expect(
      memory.edit(ownerId, saved.id, {
        ...first,
        sourceRequest: 'Remember that conflicting',
      }),
    ).rejects.toEqual(new MemoryError('IDEMPOTENCY_CONFLICT'));
    await expect(memory.save(ownerId, initial)).rejects.toEqual(
      new MemoryError('ENTRY_CHANGED'),
    );
    const latest = await memory.edit(
      ownerId,
      saved.id,
      edit(2, 'Newest preference'),
    );
    await expect(memory.edit(ownerId, saved.id, first)).rejects.toEqual(
      new MemoryError('ENTRY_CHANGED'),
    );
    await expect(memory.forget(ownerId, saved.id, forget(2))).rejects.toEqual(
      new MemoryError('ENTRY_CHANGED'),
    );
    expect(await memory.get(ownerId, saved.id)).toEqual(latest);
  });

  it('erases forgotten content, suppresses old requests, and permits a deliberate fresh save', async () => {
    const initial = command('Secret synthetic wording');
    const saved = await memory.save(ownerId, initial);
    const editedInput = edit(1);
    await memory.edit(ownerId, saved.id, editedInput);
    const deletion = forget(2);
    const removed = await memory.forget(ownerId, saved.id, deletion);
    expect(removed).toMatchObject({ state: 'forgotten', revision: 3 });
    expect(await memory.forget(ownerId, saved.id, deletion)).toEqual(removed);
    expect(await memory.forget(ownerId, saved.id, forget(1))).toEqual(removed);
    expect((await memory.list(ownerId)).entries).toEqual([]);
    expect(await memory.get(ownerId, saved.id)).toEqual(removed);
    expect(await memory.findByRequest(ownerId, initial.requestId)).toEqual(
      removed,
    );
    for (const operation of [
      () => memory.save(ownerId, initial),
      () => memory.edit(ownerId, saved.id, editedInput),
    ])
      await expect(operation()).rejects.toEqual(new MemoryError('FORGOTTEN'));
    const row = (
      await connection.pool.query(
        'select text, source_request from memories where id=$1',
        [saved.id],
      )
    ).rows[0];
    expect(row).toEqual({ text: null, source_request: null });
    expect(JSON.stringify(removed)).not.toContain('wording');
    expect(
      (await memory.save(ownerId, command('Secret synthetic wording'))).id,
    ).not.toBe(saved.id);
  });

  it('allows only one competing tab edit and does not spend capacity on forgotten markers', async () => {
    const entries = await Promise.all(
      Array.from({ length: 20 }, () => memory.save(ownerId, command('x'))),
    );
    const saved = entries[0]!;
    const results = await Promise.allSettled([
      memory.edit(ownerId, saved.id, edit(1, 'first')),
      memory.edit(ownerId, saved.id, edit(1, 'second')),
    ]);
    expect(
      results.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(results.filter((value) => value.status === 'rejected')).toHaveLength(
      1,
    );
    await memory.forget(ownerId, saved.id, forget(2));
    await memory.save(ownerId, command('replacement'));
    expect((await memory.list(ownerId)).entries).toHaveLength(20);
    expect(await countMemories()).toBe(21);
  });

  it('enforces mutation ownership and capacity while preserving current content on rejection', async () => {
    const saved = await memory.save(ownerId, command('original'));
    await expect(memory.edit(otherOwnerId, saved.id, edit(1))).rejects.toEqual(
      new MemoryError('NOT_FOUND'),
    );
    await expect(
      memory.forget(otherOwnerId, saved.id, forget(1)),
    ).rejects.toEqual(new MemoryError('NOT_FOUND'));
    for (let i = 0; i < 7; i++)
      await memory.save(ownerId, command('a'.repeat(512)));
    await memory.save(ownerId, command('a'.repeat(504)));
    await expect(
      memory.edit(ownerId, saved.id, edit(1, 'a'.repeat(512))),
    ).rejects.toEqual(new MemoryError('LIMIT_EXCEEDED'));
    expect(await memory.get(ownerId, saved.id)).toEqual(saved);
  });

  it('rejects new changes while generating but allows replays and deadline release', async () => {
    const saved = await memory.save(ownerId, command());
    const editInput = edit(1);
    const changed = await memory.edit(ownerId, saved.id, editInput);
    const admitted = await conversation.submit(
      {
        ownerId,
        historyVersion: 0,
        requestId: randomUUID(),
        text: 'Synthetic question',
      },
      limits,
    );
    await expect(memory.edit(ownerId, saved.id, edit(2))).rejects.toEqual(
      new MemoryError('BUSY'),
    );
    await expect(memory.forget(ownerId, saved.id, forget(2))).rejects.toEqual(
      new MemoryError('BUSY'),
    );
    expect(await memory.edit(ownerId, saved.id, editInput)).toEqual(changed);
    await connection.pool.query(
      "update conversation_attempts set started_at=clock_timestamp()-interval '2 seconds', deadline_at=clock_timestamp()-interval '1 second' where id=$1",
      [admitted.attempt.id],
    );
    await memory.forget(ownerId, saved.id, forget(2));
    const result = await conversation.finish(
      { ownerId, historyVersion: 0, attemptId: admitted.attempt.id },
      {
        state: 'completed',
        answer: 'Old wording',
        usage: null,
        sources: [],
        activity: [],
        contextLimited: false,
      },
    );
    expect(result?.state).toBe('interrupted');
  });

  it('excludes earlier exchanges after each mutation and resets the boundary with Clear history', async () => {
    async function completed(text: string, version = 0) {
      const admitted = await conversation.submit(
        { ownerId, historyVersion: version, requestId: randomUUID(), text },
        limits,
      );
      const ref = {
        ownerId,
        historyVersion: version,
        attemptId: admitted.attempt.id,
      };
      await conversation.finish(ref, {
        state: 'completed',
        answer: `Restating ${text}`,
        usage: null,
        sources: [],
        activity: [],
        contextLimited: false,
      });
      return { admitted, ref };
    }
    await completed('old preference');
    const saved = await memory.save(ownerId, command());
    const next = await completed('new question');
    expect(
      await conversation.context(next.ref, next.admitted.turn.sequence),
    ).toEqual([]);
    const after = await completed('follow up');
    expect(
      await conversation.context(after.ref, after.admitted.turn.sequence),
    ).toEqual([{ text: 'new question', answer: 'Restating new question' }]);
    await memory.edit(ownerId, saved.id, edit(1));
    const edited = await completed('after edit');
    expect(
      await conversation.context(edited.ref, edited.admitted.turn.sequence),
    ).toEqual([]);
    await memory.forget(ownerId, saved.id, forget(2));
    const forgotten = await completed('after forget');
    expect(
      await conversation.context(
        forgotten.ref,
        forgotten.admitted.turn.sequence,
      ),
    ).toEqual([]);
    expect((await conversation.history(ownerId)).turns).toHaveLength(5);
    await conversation.clear(ownerId, 0);
    await completed('first new version', 1);
    const second = await completed('second new version', 1);
    expect(
      await conversation.context(second.ref, second.admitted.turn.sequence),
    ).toEqual([
      { text: 'first new version', answer: 'Restating first new version' },
    ]);
  });

  it('rolls back both the edit and context boundary if context reset fails', async () => {
    const saved = await memory.save(ownerId, command());
    await conversation.clear(ownerId, 0);
    await connection.pool.query(
      "create function reject_memory_context() returns trigger language plpgsql as $$ begin raise exception 'synthetic'; end $$",
    );
    try {
      await connection.pool.query(
        'create trigger reject_memory_context before update on conversations for each row execute function reject_memory_context()',
      );
      await expect(memory.edit(ownerId, saved.id, edit(1))).rejects.toThrow();
      expect(await memory.get(ownerId, saved.id)).toEqual(saved);
    } finally {
      await connection.pool.query(
        'drop trigger if exists reject_memory_context on conversations',
      );
      await connection.pool.query(
        'drop function if exists reject_memory_context()',
      );
    }
  });

  it('backfills existing conversation boundaries through the actual upgrade SQL', async () => {
    const client = await connection.pool.connect();
    try {
      await client.query('begin');
      await client.query('create schema memory_upgrade_test');
      await client.query('set local search_path = memory_upgrade_test, public');
      await client.query(
        'create table conversations(owner_id uuid, next_sequence integer not null)',
      );
      await client.query(
        'create table memories(owner_id uuid, text text not null, source_request text not null)',
      );
      const other = randomUUID();
      await client.query('insert into conversations values($1,7),($2,4)', [
        ownerId,
        other,
      ]);
      await client.query(
        "insert into memories values($1,'wording','Remember that wording')",
        [ownerId],
      );
      const migration = await readFile(
        new URL(
          '../../packages/backend/drizzle/0010_memory_mutations.sql',
          import.meta.url,
        ),
        'utf8',
      );
      for (const statement of migration.split('--> statement-breakpoint'))
        if (statement.trim()) await client.query(statement);
      const rows = await client.query(
        'select context_start_sequence from conversations order by next_sequence',
      );
      expect(rows.rows).toEqual([
        { context_start_sequence: 1 },
        { context_start_sequence: 7 },
      ]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
