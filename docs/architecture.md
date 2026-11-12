# Architecture

Mentor has three application processes and one PostgreSQL database:

```text
Browser → Portless HTTPS → Next.js web → /api rewrite → NestJS API → PostgreSQL
                                                       |
                                                       └→ OpenAI Responses
NestJS worker → PostgreSQL readiness checks
```

`pnpm dev` serves the web app at https://mentor.localhost and supplies that origin
for cookie/CSRF checks. The API and worker listen on loopback ports 3001 and 3002;
PostgreSQL uses port 55432 by default. Direct development without Portless uses
http://127.0.0.1:3000. See [development](development.md) for configuration.

## Process responsibilities

**Web** renders sign-in, the conversation workspace, and the Memory panel.
Generated API types and browser-owned response validation sit at its HTTP boundary.
TanStack Query holds session-scoped saved state; drafts and provisional answer
text remain in memory. Next.js proxies API calls and contains no database queries
or backend business rules.

**API** authenticates requests, checks exact Origin and CSRF for mutations, and
invokes backend use cases. Controllers own decoding and response presentation;
`ConversationStreamService` owns SSE delivery. Composition supplies database,
model, and cross-module capabilities to plain application classes.

**Worker** exposes liveness/readiness and closes its database connections on
shutdown. It has no job handlers and does not resume conversation attempts.

**PostgreSQL** stores the owner, sessions, login budget, conversation, turns,
attempts, and explicit memories. Versioned Drizzle migrations include pgvector;
semantic retrieval is not implemented.

## Module ownership

| Module       | Owns                                                                                   | Implementation guide                            |
| ------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Identity     | Owner provisioning/reset, credentials, sessions, throttling, owner lock                | [Identity boundaries](identity-architecture.md) |
| Conversation | Singleton history, admission/replay, retries, context selection, deadlines, completion | [Conversation loop](conversation-loop.md)       |
| Memory       | Literal capture, active wording, revisions, forgetting, mutation recovery              | [Personal memory](personal-memory.md)           |

Backend domain/application code stays independent of NestJS, HTTP, Drizzle, and
the model SDK. Application ports describe capabilities; adapters implement them.
Declared package entry points and ESLint enforce import direction. See
[module boundaries](module-boundaries.md).

Repositories query only their module's tables. API composition coordinates memory
mutations and conversation context resets through public capabilities in one
transaction under the identity-owned owner lock. Conversation admission takes the
same lock, preventing a new memory change from racing active generation. Model
calls run outside database transactions.

## Follow a message

1. The browser gets a session-bound CSRF token and submits text, a request UUID,
   and the observed history version through the Next.js rewrite.
2. The API guard authenticates and checks Origin/CSRF; application validation
   checks the command before admission.
3. Under the owner lock, conversation admission resolves replay/conflicts or
   commits a turn and running attempt. SSE acceptance describes committed state.
4. The use case reads current active memories and eligible recent completed
   exchanges, then selects bounded context.
5. The SDK adapter calls Responses, offering hosted web search. Text deltas are
   provisional and never become durable context.
6. Conditional completion checks the deadline/history version before saving the
   final answer, validated evidence, usage, or a sanitized failure.
7. The browser displays saved state. Disconnects recover through history without
   automatically submitting another attempt.

## Contracts and health

`pnpm build:services && pnpm api:generate` exports NestJS OpenAPI and generates
`packages/api-client` types without a database connection. The browser imports
that client, never backend implementations. `packages/memory-command` contains
browser-safe literal command parsing shared with the backend.

Liveness checks show that a process is running. Readiness checks query PostgreSQL;
API readiness also verifies the vector extension. They return fixed responses
without credentials or owner content.

## Verification boundary

Unit tests exercise application/domain behavior with injected ports. Integration
checks apply real migrations to disposable PostgreSQL and test authenticated HTTP
and SDK composition. SDK tests use localhost provider responses. Local integrated
phone/desktop acceptance covers real cookies/CSRF, the Next.js rewrite, persistence,
streaming, recovery, and memory context changes. These results do not establish
live model behavior or deployed TLS/proxy behavior. See the feature guides for
verification commands and remaining limits.
