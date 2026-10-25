export class InvalidCredentialsError extends Error {}

export class LoginThrottledError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many sign-in attempts.');
  }
}

export class OwnerAlreadyExistsError extends Error {
  constructor() {
    super('An owner already exists. This command never replaces credentials.');
  }
}

export class OwnerNotFoundError extends Error {
  constructor() {
    super(
      'No owner matches that email. Check the email or run pnpm owner:create for initial setup.',
    );
  }
}
