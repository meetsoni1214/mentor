import { readDatabaseEnvironment } from '../../../../config/environment.js';
import { createDatabase } from '../../../../database/index.js';
import { Argon2PasswordHasher } from '../../driven/crypto/argon2-password.hasher.js';
import { DrizzleOwnerRepository } from '../../driven/persistence/drizzle/drizzle-owner.repository.js';
import { OwnerAlreadyExistsError } from '../../../domain/errors/identity.errors.js';
import { ProvisionOwner } from '../../../application/provision-owner.js';
import { ownerCredentials } from './credentials.js';
import { PromptCancelledError, readOwnerCredentials } from './hidden-prompt.js';

async function main() {
  if (
    process.argv.length !== 2 ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    console.error(
      'Run pnpm owner:create in an interactive terminal without arguments.',
    );
    process.exitCode = 1;
    return;
  }

  const connection = createDatabase(readDatabaseEnvironment());
  connection.pool.on('error', () => {
    console.error('Database connection interrupted during owner setup.');
  });
  try {
    const repository = new DrizzleOwnerRepository(connection.db);
    if (await repository.exists()) throw new OwnerAlreadyExistsError();

    const credentials = ownerCredentials.safeParse(
      await readOwnerCredentials(),
    );
    if (!credentials.success) {
      // Zod errors can carry input values; print only these fixed messages.
      console.error(
        'Enter a valid email, a 9–128 character password, and matching confirmation.',
      );
      process.exitCode = 1;
      return;
    }
    await new ProvisionOwner(repository, new Argon2PasswordHasher()).execute(
      credentials.data,
    );
    console.info(
      'Owner account created. You can now sign in through the web app.',
    );
  } finally {
    await connection.pool.end();
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof OwnerAlreadyExistsError ||
    error instanceof PromptCancelledError
  ) {
    console.error(error.message);
  } else {
    console.error(
      'Owner setup failed. Check database access and run pnpm db:migrate before retrying.',
    );
  }
  process.exitCode = error instanceof PromptCancelledError ? 130 : 1;
});
