# Mentor

A personal assistant built incrementally. Owner provisioning, password recovery,
browser sign-in, database sessions, and logout are implemented. The backend now
provides one continuous conversation per owner, persistent turns and attempts,
bounded context, an OpenAI Agents SDK/Responses adapter, and protected conversation
HTTP endpoints with generated client types. The signed-in web screen now shows a
read-only conversation workspace with history pagination and run details. Reliable
sending and public-web investigation are the next slices.
Notes, long-term memory, email access, and external actions remain future work.

The backend also exposes opt-in SSE submission with provisional text and saved
results alongside the compatible JSON route. Browser streaming remains a later
slice. See the [backend streaming contract](docs/conversation-loop.md#backend-streaming-slice-1).

Browser branding, design tokens, and reusable controls follow the
[design system guide](docs/design-system.md). Name, logo, colors, and typography
are shared across sign-in and the conversation workspace.

## Prerequisites

- Node.js 24.14 or later in the 24.x series (`.nvmrc` pins 24.14.0)
- pnpm 11.1.2 (pinned in `package.json`)
- Docker with Compose, running and accessible from your terminal

## Start locally

Run these commands from the repository root:

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

Copy the environment example only on first setup; preserve an existing `.env`.
The values in the example are for local development. No OpenAI key is needed for
bootstrap, authentication, history reading/clearing, or deterministic verification.

AI configuration becomes ready automatically with a valid explicit model, server
key, and limits. Missing or invalid settings keep execution unavailable while
stored history remains readable and clearable. Authenticated status returns only
readiness and safe settings, without credentials or configuration diagnostics.
Preserve an existing `.env`; do not copy over it to pick up optional values.

| Service           | Address                                   | Purpose                                      |
| ----------------- | ----------------------------------------- | -------------------------------------------- |
| Web               | http://127.0.0.1:3000                     | Sign-in and read-only conversation workspace |
| API               | http://127.0.0.1:3001/api/v1/health/live  | API liveness                                 |
| API readiness     | http://127.0.0.1:3001/api/v1/health/ready | Database connection and pgvector migration   |
| API documentation | http://127.0.0.1:3001/api/docs            | Development OpenAPI explorer                 |
| Worker            | http://127.0.0.1:3002/health/live         | Worker process liveness                      |
| Worker readiness  | http://127.0.0.1:3002/health/ready        | Worker database connectivity                 |
| PostgreSQL        | 127.0.0.1:55432                           | Persistent development database              |

`pnpm dev` builds the service code, generates API client types, and starts the
TypeScript watcher, API, worker, and web processes together. Ctrl+C stops the
application processes. `pnpm db:down` stops PostgreSQL without deleting its volume.

All application listeners and the database port bind to loopback by default.
Sign-in has local database, API, and browser verification. Deployment hardening
and deployed HTTPS verification remain pending. Keep this development setup local.

## Create your owner account

After starting PostgreSQL, run these commands in your own terminal:

```bash
pnpm db:migrate
pnpm owner:create
```

The command prompts for an email, password, and password confirmation. All input
is hidden. It creates one account and refuses to replace an existing owner.
Do not pass credentials as command arguments or put them in `.env`.

Forgot your password? Run `pnpm owner:reset-password` in your terminal. It asks
for your existing email and a new 9–128 character password, preserves your
account, and signs out all sessions.

Local sign-in details can be kept in [README.local.md](README.local.md), which is
excluded from Git.

See [owner setup](docs/owner-setup.md) for the command's flow and current limits.
After creating the account, open http://127.0.0.1:3000 and sign in. Keep this
browser address consistent: mutation requests must match `APP_ORIGIN`, which
defaults to `http://127.0.0.1:3000`. Restart `pnpm dev` after applying the new
migration. See [sign-in and sessions](docs/sign-in.md) for the request flow.

## Conversation API checkpoint

The API exposes these authenticated endpoints under `/api/v1`:

| Method | Path                                 | Purpose                                                 |
| ------ | ------------------------------------ | ------------------------------------------------------- |
| GET    | `/assistant/status`                  | Read execution readiness and safe settings              |
| GET    | `/conversation`                      | Read the singleton transcript with versioned pagination |
| POST   | `/conversation/turns`                | Submit text with a request UUID and history version     |
| POST   | `/conversation/turns/{turnId}/retry` | Explicitly retry the latest unsuccessful turn           |
| DELETE | `/conversation/history`              | Clear local history using its observed version          |

Mutations require the existing session, exact `APP_ORIGIN`, and session-bound
`X-CSRF-Token`. Responses use private/no-store caching. There are no conversation
creation or selection endpoints. See the development OpenAPI explorer for the
generated DTOs and [the conversation guide](docs/conversation-loop.md#protected-api-contract)
for request bodies, pagination, and recovery errors.

To configure execution, set `OPENAI_API_KEY` and an explicit account-available
`OPENAI_CHAT_MODEL` in your existing server environment, then restart the API.
There is no default model or enable flag. Once configuration is valid, an
authenticated submit or retry can make paid requests to OpenAI. The current web
workspace has a disabled composer; configuring the API does not enable browser
sending. See [the conversation UI checkpoint](docs/conversation-ui-plan.md#checkpoint-2-implementation-and-verification).

The request path is controller → application validation/admission → persisted
turn/attempt → bounded context → Agents SDK → conditional database completion.
PostgreSQL owns history; the SDK has no durable session or cross-turn provider
conversation. Defaults are 8 KiB per message, 32 KiB for the initial transcript,
2,048 output tokens per model call, a 60-second attempt deadline, and one active
attempt per owner. The pinned SDK uses its default ten-iteration limit. These
settings do not impose a cumulative token or daily spending cap.

The adapter sets `store: false`, disables automatic retries and tracing/export,
and omits sensitive SDK logging. This does not promise zero provider retention.
Messages and selected recent context go to OpenAI; public-web search is currently
unavailable. Documentation explains cloud processing, limited context, and that
permitted web search can send derived queries to that service. The composer has
no cloud-processing or privacy footer, at the owner's request. No persisted
acknowledgement is required. Clearing local
history cannot retract content already sent externally.

Execution runs inside the original HTTP request. A lost response can be reconciled
with history or the same request key; it must not cause a new automatic attempt.
Process failure can leave a running attempt until its deadline is reconciled as
interrupted. Retry starts fresh and is explicit. The worker does not resume runs.
The [configuration and recovery guide](docs/conversation-loop.md) records these
limits and the local verification evidence. Live OpenAI verification and the
complete conversation interaction walkthrough remain pending.

## Daily commands

```bash
pnpm check              # Format, lint, typecheck, unit tests, build
pnpm test:integration   # A separate, disposable database; requires Docker
pnpm format             # Format maintained source and documentation
pnpm db:logs            # PostgreSQL logs
```

To build and run without watchers:

```bash
pnpm build
pnpm start:api
```

In separate terminals, run `pnpm start:worker` and `pnpm start:web`. The root
start commands load `.env` for the backend services; web loads the same file
through its server configuration. The browser does not receive database secrets.

## Layout

```text
apps/
  web/             Next.js presentation
  api/             NestJS HTTP entry point
  worker/          NestJS worker entry point and health listener
packages/
  backend/         Identity/conversation use cases, ports, adapters, migrations
  api-client/      OpenAPI-generated types and typed fetch client
scripts/           Isolated integration-test runner
tests/             Unit and real-database integration checks
docs/              Architecture and development notes
openspec/          Product plan and tracked milestones
```

Read [the architecture walkthrough](docs/architecture.md) for the service
boundaries and [the development guide](docs/development.md) for migrations,
configuration, and troubleshooting.
