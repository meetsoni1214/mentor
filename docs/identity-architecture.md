# Identity boundaries

Identity owns owner provisioning, administrative password recovery, and browser
sessions. HTTP integration belongs to the API;
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
adapters. Feature schemas reference the public identity schema for owner foreign
keys.
Composition uses identity persistence's public owner-lock capability; repositories
query only their own module's tables.

## Follow sign-in

At startup, `IdentityModule` validates authentication configuration and constructs
`Sessions` from a Drizzle repository, password verifier, token generator, and
session lifetime values. It injects that use case and HTTP settings into
`AuthHttpService`, and registers the controller and global `AccessGuard`.
The root API module composes identity, conversation, memory, and health, and
keeps the global HTTP error filter. OpenAPI export can construct this graph without
connecting to PostgreSQL.

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

Identity use cases are available through `@mentor/backend/identity`. Crypto,
persistence, and schemas have separate entry points; the former root export has
been removed. [Module boundaries](module-boundaries.md) documents the exports and
lint enforcement. Conversation mapping
and state-specific types are covered in [the conversation walkthrough](conversation-loop.md).
The conversation walkthrough also describes the pure context selector.
