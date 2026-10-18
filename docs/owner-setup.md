# Owner account creation

This slice adds account storage and an interactive administrative command.
There is no public registration endpoint. Browser login, sessions, and password
verification are described in [sign-in and sessions](sign-in.md). Administrative
password recovery is available through the local reset command below.

## Run it

Use Node 24.14 or later in the 24.x series and start the development database.
From the repository root:

```bash
pnpm db:migrate
pnpm owner:create
```

Enter your email, a password of 9–128 Unicode characters, and the same password
again. Each prompt hides all input, including the email, so pasted credentials
cannot accidentally be echoed. Press Enter after each answer. Ctrl+C cancels
during input and restores the terminal. Piped input and command arguments are
rejected. Keep the password in your password manager, not in this repository,
shell arguments, environment files, or chat.

The email is trimmed and lowercased. Passwords retain their exact characters,
including spaces. The command validates all input before hashing or inserting.
It prints a fixed success message without the email, password, or hash.

If an owner already exists, the command fails without replacing credentials.
Invalid input also exits without creating an account; rerun to correct it.
For a database error, check connectivity and apply migrations first. Do not
delete the owner row to reset a password; use the reset command below.

## Follow the code

1. `package.json` builds backend code and runs
   `packages/backend/src/identity/cli/provision-owner.ts` with the root `.env`.
2. The CLI checks whether an owner exists, reads hidden input, and validates it
   with `cli/credentials.ts`.
3. `application/provision-owner.ts` checks again, calls a password-hashing port,
   and asks the repository to create the account. It imports neither NestJS nor
   Drizzle.
4. `adapters/argon2-password.hasher.ts` uses Node's Argon2id implementation with
   a random 16-byte salt and a 32-byte result. It stores a PHC string containing
   the algorithm, version, cost parameters, salt, and hash.
5. `adapters/drizzle-owner.repository.ts` inserts the owner and returns whether
   it succeeded. The CLI always closes its database pool.

The `owners` table has a UUID, email, password hash, creation timestamp, and a
single-owner slot. The slot must be `true` and unique. These database constraints
prevent two concurrent commands from creating two accounts; the losing insert
does nothing. An existing account is never updated by this command.

Migration `0001_owner_account.sql` adds this table. The earlier pgvector
migration is unchanged, so existing development databases can migrate forward.

## Hashing choice

The configuration is Argon2id with 19 MiB memory, two passes, and one lane,
matching an [OWASP recommended minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
The [Node 24.14 crypto API](https://nodejs.org/download/release/v24.14.0/docs/api/crypto.html#cryptoargon2algorithm-parameters-callback)
labels its Argon2 API a release candidate. It is isolated behind `PasswordHasher`
so the implementation can change without changing the account-creation use case.
No extra native npm dependency is required for this slice.

## Current verification limits

Real-database integration tests verify Argon2 credentials, refusal to replace an
existing owner, and competing provisioning attempts preserving a single owner.
The hidden-input provision/reset commands also passed a local interactive check
against a disposable database. See [sign-in verification](sign-in.md#verification-status)
for the session, HTTP, and browser checks and remaining deployment limits.

## Recover a forgotten password

Run `pnpm owner:reset-password` in your own interactive terminal. Enter the
existing owner email, a new password of 9–128 Unicode characters, and matching
confirmation. Input is hidden. No old password is needed: this is an
administrative command requiring access to the application's database settings.
Do not send passwords in chat, pass them as arguments, or put them in `.env`.
Ctrl+C cancels during input without changing credentials.

The command preserves the owner ID, email, creation timestamp, and account data.
It atomically updates the Argon2id hash, deletes all owner sessions, and clears
the login throttle so you can sign in immediately. A missing email or failed
transaction leaves credentials and sessions unchanged. Session creation locks
the owner row and checks the verified password hash, preventing a login using
the previous password from creating a session after reset commits. Requests
already authenticated before reset may finish; subsequent session checks fail.
No migration, API endpoint, or browser reset page is added.
