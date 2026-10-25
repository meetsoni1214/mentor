# The first layer

The bootstrap establishes three application processes and a database. Each
process has an entry point, environment validation, and a clear responsibility.

```text
Browser
   |
   v
Next.js :3000 -- /api/* proxy --> NestJS API :3001
                                      |
                                      v
                              PostgreSQL :55432
                                      ^
                                      |
                              NestJS worker :3002
```

## Why separate these services?

**Web** renders the interface. Its `/api/*` rewrite forwards requests to NestJS,
which keeps browser calls on the same origin. There are no database queries or
backend business rules in Next.js.

**API** will receive requests, authenticate them, and invoke application use
cases. It now exposes authentication and health endpoints plus development API
docs. A global guard requires a valid session unless a route is explicitly public;
mutations additionally require an allowed Origin and a valid CSRF token.

**Worker** is a separately runnable NestJS process. It currently exposes health
checks and closes database connections on shutdown. It has no job handlers yet;
durable queue dispatch will be added with capture processing.

**PostgreSQL** stores persistent data. The first Drizzle migration enables
pgvector so future semantic search can use the same database. A second migration
adds the single owner account used by the administrative setup command.
A third adds sessions and a shared login-attempt budget.

The service entry points share a backend package. As features arrive, their
domain and application code will stay separate from NestJS transport and Drizzle
adapters. No empty hierarchy is needed before those behaviors exist.

The first feature module is `packages/backend/src/identity`: the CLI validates
input, an application use case coordinates hashing and account creation, and
adapters implement the hashing and database ports. See [owner setup](owner-setup.md)
for its execution flow.
The same module now owns session use cases. API controllers and guards adapt
HTTP requests; the frontend calls the generated client and stores session state
in TanStack Query. See [sign-in](sign-in.md) for the complete path.

Identity is the first module organized with explicit domain models/errors/policy,
application ports and use cases, driving CLI/HTTP adapters, and driven
Drizzle/crypto adapters. API-specific adapters and Nest composition remain in
`apps/api/src/identity`; shared use cases and adapters remain in
`packages/backend/src/identity`. The API imports `IdentityModule`, whose provider
factory constructs the plain `Sessions` class and registers the global guard.
See [identity boundaries](identity-architecture.md) for the reference layout and
the atomic login-throttle boundary. Other modules retain their existing layouts
until their own review checkpoints.

The next module, `packages/backend/src/conversation`, implements one continuous
conversation's persistence and run lifecycle. Domain types and rules live in
`domain/`; use-case coordination and contracts live in `application/`, with
repository/model ports in `application/ports/`. Adapters implement those ports
and depend inward on the application and domain.
Conversation admission policies own replay, conflict, history-version, and
concurrency decisions. The Drizzle adapter loads their inputs and evaluates them
under its database lock before persisting changes; the policies have no ORM or
framework dependencies.
It is tested directly with real PostgreSQL and an injected fake provider; it has
no HTTP or UI integration yet. See [the conversation-loop walkthrough](conversation-loop.md)
for its request flow, concurrency rules, and review order.

## Follow a request

1. The web page links to `/api/v1/health/ready`.
2. Next.js forwards that request to the API.
3. The health controller asks the shared database service whether PostgreSQL is
   reachable and the vector extension exists.
4. The API responds with HTTP 200 when ready or HTTP 503 otherwise.

`/health/live` does not query the database. This distinction lets a supervisor
tell a stopped process from a running process whose dependency is unavailable.
Health responses do not expose connection strings or passwords.

## Follow a contract change

NestJS describes the HTTP contract through OpenAPI. `pnpm api:generate` exports
that contract without requiring database access, then generates TypeScript types
in `packages/api-client`. The frontend consumes the client package and never
imports backend implementations. Build and development commands perform this
generation before web compilation.

## What the foundation does not prove

Successful bootstrap checks establish that the services build, connect, and
shut down correctly. They do not establish authentication, safe personal-data
handling, AI quality, background task reliability, or production readiness.
Those behaviors have their own later implementation and verification steps.
