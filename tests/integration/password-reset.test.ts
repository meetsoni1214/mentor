import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@mentor/backend/database';
import { readDatabaseEnvironment } from '@mentor/backend/config';
import {
  Argon2PasswordHasher,
  RandomSessionTokens,
} from '@mentor/backend/identity/crypto';
import {
  DrizzleOwnerPasswordResetRepository,
  DrizzleSessionRepository,
} from '@mentor/backend/identity/persistence';
import {
  ResetOwnerPassword,
  Sessions,
  OwnerNotFoundError,
  InvalidCredentialsError,
} from '@mentor/backend/identity';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test') {
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
}
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const passwords = new Argon2PasswordHasher();
const repository = new DrizzleSessionRepository(connection.db);
const reset = new ResetOwnerPassword(
  new DrizzleOwnerPasswordResetRepository(connection.db),
  passwords,
);
const email = 'owner@example.test';
const oldPassword = 'old private password';
const newPassword = 'new private password';
const auth = new Sessions(repository, passwords, new RandomSessionTokens(), {
  idleMs: 60_000,
  absoluteMs: 120_000,
});

describe('administrative owner password reset', () => {
  beforeAll(async () => {
    await migrateDatabase(connection);
  });
  beforeEach(async () => {
    await connection.pool.query('truncate owners, login_throttle cascade');
    await connection.pool.query(
      'insert into owners (email, password_hash) values ($1, $2)',
      [email, await passwords.hash(oldPassword)],
    );
  });
  afterAll(async () => {
    await connection.pool.end();
  });

  it('preserves identity, revokes every session, clears throttling and accepts only the new password', async () => {
    const owner = await repository.findOwner();
    const first = await auth.login({ email, password: oldPassword }, null);
    const second = await auth.login({ email, password: oldPassword }, null);
    for (let i = 0; i < 5; i++)
      await repository.reserveLoginAttempt(new Date());
    await reset.execute({
      email: ' OWNER@example.test ',
      password: newPassword,
    });
    expect(await repository.findOwner()).toMatchObject({
      id: owner?.id,
      email,
    });
    expect(await auth.authenticate(first.token)).toBeNull();
    expect(await auth.authenticate(second.token)).toBeNull();
    await expect(
      auth.login({ email, password: oldPassword }, null),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    const fresh = await auth.login({ email, password: newPassword }, null);
    expect(await auth.authenticate(fresh.token)).not.toBeNull();
  });

  it('rejects session creation using credentials verified before reset', async () => {
    const owner = await repository.findOwner();
    if (!owner) throw new Error('Missing test owner');
    await reset.execute({ email, password: newPassword });
    expect(
      await repository.create({
        ownerId: owner.id,
        expectedPasswordHash: owner.passwordHash,
        tokenHash: 'stale-login',
        previousTokenHash: null,
        now: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBe(false);
  });

  it('leaves credentials and sessions intact for a mismatched email or invalid password', async () => {
    const session = await auth.login({ email, password: oldPassword }, null);
    const owner = await repository.findOwner();
    await expect(
      reset.execute({ email: 'other@example.test', password: newPassword }),
    ).rejects.toBeInstanceOf(OwnerNotFoundError);
    await expect(reset.execute({ email, password: 'short' })).rejects.toThrow();
    expect(await repository.findOwner()).toEqual(owner);
    expect(await auth.authenticate(session.token)).not.toBeNull();
  });

  it('rolls back the password update when session revocation fails', async () => {
    const session = await auth.login({ email, password: oldPassword }, null);
    const owner = await repository.findOwner();
    await connection.pool.query(
      "create function reject_session_delete() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$",
    );
    await connection.pool.query(
      'create trigger reject_session_delete before delete on sessions for each row execute function reject_session_delete()',
    );
    try {
      await expect(
        reset.execute({ email, password: newPassword }),
      ).rejects.toThrow();
      expect(await repository.findOwner()).toEqual(owner);
      expect(await auth.authenticate(session.token)).not.toBeNull();
    } finally {
      await connection.pool.query(
        'drop trigger reject_session_delete on sessions',
      );
      await connection.pool.query('drop function reject_session_delete()');
    }
  });
});
