import { describe, expect, it } from 'vitest';
import { loginCredentials } from '../../packages/backend/src/identity/application/credentials.js';
import { ownerCredentials } from '../../packages/backend/src/identity/adapters/driving/cli/credentials.js';

describe('owner password policy', () => {
  it('accepts nine characters and rejects eight', () => {
    expect(
      loginCredentials.safeParse({
        email: 'owner@example.test',
        password: 'a'.repeat(9),
      }).success,
    ).toBe(true);
    expect(
      loginCredentials.safeParse({
        email: 'owner@example.test',
        password: 'a'.repeat(8),
      }).success,
    ).toBe(false);
  });

  it('counts Unicode characters and preserves the 128 character maximum', () => {
    expect(
      loginCredentials.safeParse({
        email: 'owner@example.test',
        password: '😀'.repeat(9),
      }).success,
    ).toBe(true);
    expect(
      loginCredentials.safeParse({
        email: 'owner@example.test',
        password: '😀'.repeat(128),
      }).success,
    ).toBe(true);
    expect(
      loginCredentials.safeParse({
        email: 'owner@example.test',
        password: 'a'.repeat(129),
      }).success,
    ).toBe(false);
  });

  it('requires matching password confirmation for administrative commands', () => {
    expect(
      ownerCredentials.safeParse({
        email: 'owner@example.test',
        password: 'a'.repeat(9),
        confirmation: 'b'.repeat(9),
      }).success,
    ).toBe(false);
  });
});
