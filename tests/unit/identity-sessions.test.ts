import { describe, expect, it, vi } from 'vitest';
import { Sessions } from '../../packages/backend/src/identity/application/sessions.js';
import type { PasswordVerifier } from '../../packages/backend/src/identity/application/ports/password-hasher.js';
import type { SessionRepository } from '../../packages/backend/src/identity/application/ports/session.repository.js';
import type { SessionTokens } from '../../packages/backend/src/identity/application/ports/session-tokens.js';
import {
  InvalidCredentialsError,
  LoginThrottledError,
} from '../../packages/backend/src/identity/domain/errors/identity.errors.js';

const owner = {
  id: 'owner-1',
  email: 'owner@example.test',
  passwordHash: 'synthetic-hash',
};
const credentials = { email: owner.email, password: 'synthetic password' };
const now = new Date('2026-10-25T12:00:00Z');

function setup() {
  const repository = {
    findOwner: vi.fn<SessionRepository['findOwner']>().mockResolvedValue(owner),
    reserveLoginAttempt: vi
      .fn<SessionRepository['reserveLoginAttempt']>()
      .mockResolvedValue(0),
    create: vi.fn<SessionRepository['create']>().mockResolvedValue(true),
    touchActive: vi
      .fn<SessionRepository['touchActive']>()
      .mockResolvedValue(null),
    revoke: vi.fn<SessionRepository['revoke']>().mockResolvedValue(undefined),
  } satisfies SessionRepository;
  const passwords = {
    verify: vi.fn<PasswordVerifier['verify']>().mockResolvedValue(true),
  } satisfies PasswordVerifier;
  const tokens = {
    generate: vi.fn<SessionTokens['generate']>().mockReturnValue('new-token'),
    digest: vi
      .fn<SessionTokens['digest']>()
      .mockImplementation((token) => `digest:${token}`),
  } satisfies SessionTokens;
  return {
    repository,
    passwords,
    tokens,
    sessions: new Sessions(
      repository,
      passwords,
      tokens,
      { idleMs: 60_000, absoluteMs: 120_000 },
      () => now,
    ),
  };
}

describe('session use cases through owned ports', () => {
  it('reserves the login budget before reading credentials or checking a password', async () => {
    const { sessions, repository, passwords, tokens } = setup();
    repository.reserveLoginAttempt.mockResolvedValue(23);
    await expect(sessions.login(credentials, null)).rejects.toBeInstanceOf(
      LoginThrottledError,
    );
    expect(repository.reserveLoginAttempt).toHaveBeenCalledWith(now);
    expect(repository.findOwner).not.toHaveBeenCalled();
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(tokens.generate).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each(['unknown owner', 'wrong password', 'wrong email'] as const)(
    'verifies the password and returns the same failure for %s',
    async (failure) => {
      const { sessions, repository, passwords, tokens } = setup();
      if (failure === 'unknown owner')
        repository.findOwner.mockResolvedValue(null);
      if (failure === 'wrong password')
        passwords.verify.mockResolvedValue(false);
      const input =
        failure === 'wrong email'
          ? { ...credentials, email: 'other@example.test' }
          : credentials;
      await expect(sessions.login(input, null)).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
      expect(passwords.verify).toHaveBeenCalledWith(
        credentials.password,
        failure === 'unknown owner' ? null : owner.passwordHash,
      );
      expect(tokens.generate).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it('returns the browser token while persisting only token digests and the verified credential version', async () => {
    const { sessions, repository } = setup();
    const expiresAt = new Date(now.getTime() + 120_000);
    const result = await sessions.login(credentials, 'previous-token');
    expect(repository.create).toHaveBeenCalledWith({
      ownerId: owner.id,
      expectedPasswordHash: owner.passwordHash,
      tokenHash: 'digest:new-token',
      previousTokenHash: 'digest:previous-token',
      now,
      expiresAt,
    });
    expect(result).toEqual({
      token: 'new-token',
      session: {
        owner: { id: owner.id, email: owner.email },
        expiresAt,
        idleExpiresAt: new Date(now.getTime() + 60_000),
      },
    });
  });

  it('rejects login if credentials changed before session creation', async () => {
    const { sessions, repository } = setup();
    repository.create.mockResolvedValue(false);
    await expect(sessions.login(credentials, null)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('does not access persistence when there is no session token', async () => {
    const { sessions, repository, tokens } = setup();
    expect(await sessions.authenticate(null)).toBeNull();
    expect(tokens.digest).not.toHaveBeenCalled();
    expect(repository.touchActive).not.toHaveBeenCalled();
  });

  it('delegates active-session enforcement using the token digest, clock, and idle limit', async () => {
    const { sessions, repository } = setup();
    const active = {
      owner: { id: owner.id, email: owner.email },
      expiresAt: new Date(now.getTime() + 120_000),
      idleExpiresAt: new Date(now.getTime() + 60_000),
    };
    repository.touchActive.mockResolvedValue(active);
    expect(await sessions.authenticate('browser-token')).toBe(active);
    expect(repository.touchActive).toHaveBeenCalledWith(
      'digest:browser-token',
      now,
      60_000,
    );
  });

  it('revokes a session by digest on logout', async () => {
    const { sessions, repository } = setup();
    await sessions.logout('browser-token');
    expect(repository.revoke).toHaveBeenCalledWith('digest:browser-token');
  });
});
