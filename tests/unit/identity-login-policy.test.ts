import { describe, expect, it } from 'vitest';
import { loginRetryAfterSeconds } from '../../packages/backend/src/identity/domain/policies/login-policy.js';

describe('owner login attempt policy', () => {
  const windowStartedAt = new Date('2026-10-25T12:00:00Z');

  it.each([1, 2, 3, 4, 5])('allows reserved attempt %i', (attempts) => {
    expect(
      loginRetryAfterSeconds({ attempts, windowStartedAt }, windowStartedAt),
    ).toBe(0);
  });

  it('blocks the sixth reserved attempt until fifteen minutes after the window began', () => {
    expect(
      loginRetryAfterSeconds({ attempts: 6, windowStartedAt }, windowStartedAt),
    ).toBe(900);
    expect(
      loginRetryAfterSeconds(
        { attempts: 6, windowStartedAt },
        new Date(windowStartedAt.getTime() + 60_000),
      ),
    ).toBe(840);
  });

  it('rounds the wait up so the advertised retry does not precede expiry', () => {
    expect(
      loginRetryAfterSeconds(
        { attempts: 6, windowStartedAt },
        new Date(windowStartedAt.getTime() + 898_999),
      ),
    ).toBe(2);
    expect(
      loginRetryAfterSeconds(
        { attempts: 6, windowStartedAt },
        new Date(windowStartedAt.getTime() + 899_999),
      ),
    ).toBe(1);
  });

  it('permits the first reserved attempt in the next window', () => {
    const nextWindow = new Date(windowStartedAt.getTime() + 900_000);
    expect(
      loginRetryAfterSeconds(
        { attempts: 1, windowStartedAt: nextWindow },
        nextWindow,
      ),
    ).toBe(0);
  });
});
