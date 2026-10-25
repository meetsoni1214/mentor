import { createHash } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@mentor/backend/database';
import { readDatabaseEnvironment } from '@mentor/backend/config';
import {
  Argon2PasswordHasher,
  RandomSessionTokens,
} from '@mentor/backend/identity/crypto';
import {
  DrizzleSessionRepository,
  DrizzleOwnerRepository,
} from '@mentor/backend/identity/persistence';
import {
  ProvisionOwner,
  Sessions,
  OwnerAlreadyExistsError,
  InvalidCredentialsError,
  LoginThrottledError,
} from '@mentor/backend/identity';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/mentor_test') {
  throw new Error(
    'Use pnpm test:integration for an isolated mentor_test database',
  );
}
const connection = createDatabase(
  readDatabaseEnvironment({ DATABASE_URL: databaseUrl }),
);
const repository = new DrizzleSessionRepository(connection.db);
const passwords = new Argon2PasswordHasher();
const credentials = {
  email: 'owner@example.test',
  password: 'private test password',
};
const start = Date.parse('2026-10-18T10:00:00.000Z');
let now = start;
const auth = new Sessions(
  repository,
  passwords,
  new RandomSessionTokens(),
  {
    idleMs: 60_000,
    absoluteMs: 120_000,
  },
  () => new Date(now),
);

describe('database-backed owner sessions', () => {
  beforeAll(async () => {
    await migrateDatabase(connection);
  });
  beforeEach(async () => {
    now = start;
    await connection.pool.query('truncate owners, login_throttle cascade');
    await connection.pool.query(
      'insert into owners (email, password_hash) values ($1, $2)',
      [credentials.email, await passwords.hash(credentials.password)],
    );
  });
  afterAll(async () => {
    await connection.pool.end();
  });

  it('provisions a single owner with verifiable Argon2 credentials', async () => {
    await connection.pool.query('delete from owners');
    const provision = new ProvisionOwner(
      new DrizzleOwnerRepository(connection.db),
      passwords,
    );
    await provision.execute(credentials);
    const owner = await repository.findOwner();
    expect(owner?.email).toBe(credentials.email);
    expect(owner?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(
      await passwords.verify(credentials.password, owner?.passwordHash ?? null),
    ).toBe(true);
    expect(
      await passwords.verify('incorrect password', owner?.passwordHash ?? null),
    ).toBe(false);
    expect((await auth.login(credentials, null)).session.owner.id).toBe(
      owner?.id,
    );
  });

  it('refuses to replace an existing owner or credentials', async () => {
    const owner = await repository.findOwner();
    const provision = new ProvisionOwner(
      new DrizzleOwnerRepository(connection.db),
      passwords,
    );
    await expect(
      provision.execute({
        email: 'replacement@example.test',
        password: 'replacement password',
      }),
    ).rejects.toBeInstanceOf(OwnerAlreadyExistsError);
    expect(await repository.findOwner()).toEqual(owner);
    expect((await auth.login(credentials, null)).session.owner.id).toBe(
      owner?.id,
    );
  });

  it('preserves the singleton owner under competing provisioning attempts', async () => {
    await connection.pool.query('delete from owners');
    const provision = new ProvisionOwner(
      new DrizzleOwnerRepository(connection.db),
      passwords,
    );
    const outcomes = await Promise.allSettled([
      provision.execute(credentials),
      provision.execute({ ...credentials, email: 'other@example.test' }),
    ]);
    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === 'rejected');
    expect(
      rejected?.status === 'rejected' ? rejected.reason : null,
    ).toBeInstanceOf(OwnerAlreadyExistsError);
    const owners = await connection.pool.query<{ email: string }>(
      'select email from owners',
    );
    expect(owners.rows).toHaveLength(1);
    expect([credentials.email, 'other@example.test']).toContain(
      owners.rows[0]?.email,
    );
  });

  it('stores only a token digest, restores identity, and revokes logout permanently', async () => {
    const login = await auth.login(credentials, null);
    const rows = await connection.pool.query<{ token_hash: string }>(
      'select token_hash from sessions',
    );
    expect(rows.rows).toEqual([
      { token_hash: createHash('sha256').update(login.token).digest('hex') },
    ]);
    expect(rows.rows[0]?.token_hash).not.toBe(login.token);
    expect(await auth.authenticate(login.token)).toEqual(login.session);
    await auth.logout(login.token);
    await auth.logout(login.token);
    expect(await auth.authenticate(login.token)).toBeNull();
    expect(await auth.authenticate(null)).toBeNull();
    expect(await auth.authenticate('unknown')).toBeNull();
  });

  it('rotates the previous browser session while preserving another browser', async () => {
    const previous = await auth.login(credentials, null);
    const other = await auth.login(credentials, null);
    const fresh = await auth.login(credentials, previous.token);
    expect(fresh.token).not.toBe(previous.token);
    expect(await auth.authenticate(previous.token)).toBeNull();
    expect(await auth.authenticate(fresh.token)).not.toBeNull();
    expect(await auth.authenticate(other.token)).not.toBeNull();
  });

  it('rejects incorrect credentials and an unprovisioned owner without creating sessions', async () => {
    await expect(
      auth.login({ ...credentials, password: 'incorrect password' }, null),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      auth.login({ ...credentials, email: 'unknown@example.test' }, null),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await connection.pool.query('delete from owners');
    await expect(auth.login(credentials, null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(
      (await connection.pool.query('select token_hash from sessions')).rows,
    ).toEqual([]);
  });

  it('expires at the exact idle deadline and cannot be revived', async () => {
    const login = await auth.login(credentials, null);
    now = start + 60_000;
    expect(await auth.authenticate(login.token)).toBeNull();
    now += 1;
    expect(await auth.authenticate(login.token)).toBeNull();
  });

  it('extends activity up to the absolute deadline, then rejects the session', async () => {
    const login = await auth.login(credentials, null);
    now = start + 59_999;
    expect((await auth.authenticate(login.token))?.idleExpiresAt).toEqual(
      new Date(start + 119_999),
    );
    now = start + 119_998;
    expect((await auth.authenticate(login.token))?.idleExpiresAt).toEqual(
      new Date(start + 120_000),
    );
    now = start + 120_000;
    expect(await auth.authenticate(login.token)).toBeNull();
  });

  it('keeps the most recent activity when requests arrive concurrently out of order', async () => {
    const login = await auth.login(credentials, null);
    const tokenHash = createHash('sha256').update(login.token).digest('hex');
    await Promise.all(
      [50_000, 20_000, 40_000, 10_000].map((offset) =>
        repository.touchActive(tokenHash, new Date(start + offset), 60_000),
      ),
    );
    await repository.touchActive(tokenHash, new Date(start + 10_000), 60_000);
    now = start + 109_999;
    expect(await auth.authenticate(login.token)).not.toBeNull();
  });

  it('atomically permits five concurrent attempts, throttles the rest, and recovers at the window deadline', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        auth.login({ ...credentials, password: 'incorrect password' }, null),
      ),
    );
    const errors = attempts.map((result) =>
      result.status === 'rejected' ? (result.reason as unknown) : null,
    );
    expect(
      errors.filter((error) => error instanceof InvalidCredentialsError),
    ).toHaveLength(5);
    expect(
      errors.filter((error) => error instanceof LoginThrottledError),
    ).toHaveLength(3);
    await expect(auth.login(credentials, null)).rejects.toMatchObject({
      retryAfterSeconds: 900,
    });
    now = start + 900_000;
    const fresh = await auth.login(credentials, null);
    expect(await auth.authenticate(fresh.token)).not.toBeNull();
  });
});
