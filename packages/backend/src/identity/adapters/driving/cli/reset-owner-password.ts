import { readDatabaseEnvironment } from '../../../../config/environment.js';
import { createDatabase } from '../../../../database/database.js';
import { Argon2PasswordHasher } from '../../driven/crypto/argon2-password.hasher.js';
import { DrizzleOwnerPasswordResetRepository } from '../../driven/persistence/drizzle/drizzle-owner-password-reset.repository.js';
import { OwnerNotFoundError } from '../../../domain/errors/identity.errors.js';
import { ResetOwnerPassword } from '../../../application/reset-owner-password.js';
import { ownerCredentials } from './credentials.js';
import { PromptCancelledError, readResetCredentials } from './hidden-prompt.js';

async function main() {
  if (
    process.argv.length !== 2 ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    console.error(
      'Run pnpm owner:reset-password in an interactive terminal without arguments.',
    );
    process.exitCode = 1;
    return;
  }
  const credentials = ownerCredentials.safeParse(await readResetCredentials());
  if (!credentials.success) {
    console.error(
      'Enter a valid email, a 9–128 character password, and matching confirmation.',
    );
    process.exitCode = 1;
    return;
  }
  const connection = createDatabase(readDatabaseEnvironment());
  connection.pool.on('error', () => {
    console.error('Database connection interrupted during password reset.');
  });
  try {
    await new ResetOwnerPassword(
      new DrizzleOwnerPasswordResetRepository(connection.db),
      new Argon2PasswordHasher(),
    ).execute(credentials.data);
    console.info(
      'Owner password reset. All existing sessions revoked. Sign in with your new password.',
    );
  } finally {
    await connection.pool.end();
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof OwnerNotFoundError ||
    error instanceof PromptCancelledError
  ) {
    console.error(error.message);
  } else {
    console.error(
      'Password reset failed. Check database access and run pnpm db:migrate before retrying.',
    );
  }
  process.exitCode = error instanceof PromptCancelledError ? 130 : 1;
});
