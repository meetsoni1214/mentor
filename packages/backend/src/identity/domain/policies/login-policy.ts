export const loginAttemptPolicy = {
  attemptLimit: 5,
  windowMs: 15 * 60 * 1000,
} as const;

// Interpret the budget returned by an atomic reservation. Persistence resets
// expired windows before calling this policy, so concurrent requests share it.
export function loginRetryAfterSeconds(
  budget: { attempts: number; windowStartedAt: Date },
  now: Date,
): number {
  return budget.attempts <= loginAttemptPolicy.attemptLimit
    ? 0
    : Math.max(
        1,
        Math.ceil(
          (budget.windowStartedAt.getTime() +
            loginAttemptPolicy.windowMs -
            now.getTime()) /
            1000,
        ),
      );
}
