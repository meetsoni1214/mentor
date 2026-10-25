# Identity boundaries

Identity is Mentor's first reference module for the architecture conventions
inspired by Rolai's SSO/EMR modules. It owns owner provisioning, administrative
password recovery, and browser sessions. HTTP integration belongs to the API;
shared behavior belongs to the backend package.

## Find the code

```text
packages/backend/src/identity/
  domain/
    models/       owner credentials, active session, session lifetime
    errors/       authentication, throttling, provisioning/reset failures
    policies/     five login attempts per fifteen-minute window
  application/
    sessions.ts
    provision-owner.ts
    reset-owner-password.ts
    credentials.ts
    ports/        persistence, password hashing/verification, token operations
  adapters/
    driving/cli/  hidden prompts, input validation, command composition
    driven/
      crypto/                 Argon2id hashing and random session tokens
      persistence/drizzle/    repositories and table schemas
  index.ts        application-facing exports; no concrete adapters

apps/api/src/identity/
  adapters/driving/http/      controller, DTOs, cookies/CSRF, global access guard
  infrastructure/            IdentityModule and provider factories
```

Domain files have no application, adapter, framework, or ORM dependencies.
Application code coordinates domain behavior through ports defined in
`application/ports`. These are plain TypeScript classes with constructor
dependencies; they do not use Nest decorators or read process environment.
Zod validates credentials at application entry boundaries.

Driven adapters implement the ports. Drizzle types and SQL remain in persistence
adapters. The database schema aggregator and conversation's existing owner
foreign-key/lock references use the relocated owner schema; no database schema
or migration changes are needed for these file moves.

## Follow sign-in

At startup, `IdentityModule` validates authentication configuration and constructs
`Sessions` from a Drizzle repository, password verifier, token generator, and
session lifetime values. It injects that use case and HTTP settings into
`AuthHttpService`, and registers the controller and global `AccessGuard`.
The root API module composes identity and health and keeps the global HTTP error
filter. OpenAPI export can construct this graph without connecting to PostgreSQL.

For a login, the guard checks Origin/CSRF, then the controller validates the
request and calls `Sessions.login`. The use case reserves a login attempt,
verifies credentials, generates a token, and asks persistence to create a session.
The HTTP adapter sets the cookie and maps the session to the existing DTO.
Authentication and logout use the same injected use case.

`Sessions` keeps login, authentication, and logout together because they share
session dependencies. Its models, errors, and ports live separately so each
responsibility is easy to find without adding forwarding services.

## Keep throttling atomic

`domain/policies/login-policy.ts` owns the attempt limit, window duration, and
retry-wait calculation. The Drizzle adapter implements the atomic reservation
using those policy values. Its single insert/upsert resets an expired window
or increments and saturates the existing counter. The policy interprets the
returned budget to allow the attempt or provide its remaining wait time.

Do not replace this with an application-level read followed by an independent
write: concurrent sign-ins could each see available capacity. The existing
five-attempt global budget still counts successful and unsuccessful sign-ins,
survives process restarts, and resets at the exact window boundary.

Session creation still locks the owner row and checks the password hash that was
verified. Password reset still changes the hash, revokes sessions, and clears
throttling in one transaction. This prevents a login verified before reset from
creating a session after reset commits.

## Follow the administrative commands

The package scripts run the compiled files under
`identity/adapters/driving/cli`. These entry points reject arguments and
non-interactive input, collect hidden credentials, construct the appropriate
use case and concrete adapters, and close their database pools. The commands
remain `pnpm owner:create` and `pnpm owner:reset-password`.

## Review and verification

Start with the domain models/errors and application ports, then read `sessions.ts`
and `IdentityModule`. Finally inspect the HTTP and persistence adapters.
Unit tests in `identity-sessions.test.ts` use injected implementations to check
throttling before password work, dummy verification, credential-reset races,
token digest handling, authentication, and logout. `identity-login-policy.test.ts`
checks attempt limits and retry-wait boundaries. Real-database and HTTP tests
remain responsible for SQL atomicity, session expiry, password-reset rollback,
Origin/CSRF, cookies, global authorization, and restart behavior.

The root backend export remains compatible with existing consumers. Package-wide
export restrictions and automated import-boundary enforcement are later slices,
as is context-selection refactoring. Conversation mapping and state-specific
types are covered by the next checkpoint in [the conversation walkthrough](conversation-loop.md).

## Verification record

Verified on 2026-10-25. Before this refactor, formatting, lint, strict types,
49 unit tests, and 48 isolated integration tests passed; the production web
build passed outside the sandbox after the existing Next.js advisory notice.

After the refactor:

- `pnpm check` passes outside the sandbox, including 66 unit tests, API contract
  generation, strict types, lint, formatting, and the production build.
- `pnpm test:integration` passes all 48 database/HTTP checks on a disposable
  PostgreSQL instance. This includes concurrent login budget reservation and
  exact-window recovery, session expiry/restart/logout, password reset and
  rollback, and existing conversation behavior after owner-schema relocation.
- The moved `pnpm owner:create` and `pnpm owner:reset-password` commands pass an
  interactive smoke check against another disposable database with synthetic
  credentials. Input stays hidden; the previous password is rejected after
  recovery, and the replacement password establishes a usable session.
- Generated OpenAPI/client files and versioned migrations have no changes.
  Strict validation of `add-assistant-conversation-loop` still passes.

Both test databases were removed. Browser acceptance was not rerun for this
structural checkpoint; the earlier browser evidence remains in sign-in.md.
The existing sandbox TypeScript-child-process limitation and Next.js 16.4.0
security advisory remain unresolved. The build's first advisory notice stops
the command; a subsequent invocation completes while retaining the warning.
