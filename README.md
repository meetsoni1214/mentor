# Mentor

A private personal assistant with owner provisioning/password recovery, browser
sign-in, and one continuous conversation. The workspace supports persistent
history, streamed answers, explicit retry, Clear history, hosted public-web search,
and validated citations. Explicit personal memory supports literal capture,
inspection, correction/forgetting, recovery, and current wording in model context.

Automatic extraction, semantic retrieval, notes, email access, background jobs,
proactivity, and external actions are not implemented. Local integrated
phone/desktop acceptance uses real authentication and disposable PostgreSQL with
localhost model responses. Live model behavior and deployed TLS/proxy behavior
remain unverified.

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

| Service           | Address                                   | Purpose                                    |
| ----------------- | ----------------------------------------- | ------------------------------------------ |
| Web               | https://mentor.localhost                  | Sign-in and conversation workspace         |
| API               | http://127.0.0.1:3001/api/v1/health/live  | API liveness                               |
| API readiness     | http://127.0.0.1:3001/api/v1/health/ready | Database connection and pgvector migration |
| API documentation | http://127.0.0.1:3001/api/docs            | Development OpenAPI explorer               |
| Worker            | http://127.0.0.1:3002/health/live         | Worker process liveness                    |
| Worker readiness  | http://127.0.0.1:3002/health/ready        | Worker database connectivity               |
| PostgreSQL        | 127.0.0.1:55432                           | Persistent development database            |

`pnpm dev` uses the pinned Portless dependency to serve the web app at
https://mentor.localhost, builds the service code, generates API client types,
and starts the TypeScript watcher, API, worker, and web processes together.
Portless assigns the web server's internal port; `/api` requests still pass through
Next.js to the loopback API. The launcher supplies the public URL as `APP_ORIGIN`
without editing `.env`. On first use, Portless may request sudo to trust its local
certificate and start its HTTPS proxy on port 443. See the
[Portless development notes](docs/development.md#portless-local-https).

Ctrl+C stops the application processes; the shared Portless proxy stays available
for other projects. `pnpm db:down` stops PostgreSQL without deleting its volume.
Use `pnpm dev:direct` for the original http://127.0.0.1:3000 setup without Portless.

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
After creating the account, open https://mentor.localhost and sign in. Keep this
browser address consistent: mutation requests must match `APP_ORIGIN`, which
`pnpm dev` sets from Portless's public URL. See
[sign-in and sessions](docs/sign-in.md) for the request flow.

## Conversation and memory

Set server-only `OPENAI_API_KEY` and an explicit account-available
`OPENAI_CHAT_MODEL` in the existing environment, then restart the API. There is
no default model or enable flag. Valid configuration enables paid submit/retry
requests and always offers hosted web search; the model chooses whether to use it.
History and memory management remain available with execution disabled.

PostgreSQL owns history and attempts. Provisional streamed text stays temporary;
lost delivery recovers through saved history without automatic replay. An
intentional retry creates a fresh attempt on the latest unsuccessful message.
Clear history preserves explicit memories.

Type `Remember that I prefer learning through small exercises.` to save literal
wording without a model call. Inspect/edit/forget it in **Memory**. Memory changes
start fresh model context while retaining visible conversation history. New
attempts receive all active wording plus bounded eligible recent exchanges.

Messages, active memory, and selected recent context go to OpenAI. Hosted search
may send derived queries externally. The adapter disables provider retries and
tracing/export and sets `store: false`; this does not promise zero provider
retention. Clearing local history cannot retract externally sent content.
Per-call limits and deadlines do not impose a cumulative spending cap.

See [the conversation guide](docs/conversation-loop.md) for API routes,
configuration, streaming/recovery, context, citations, and verification. See
[personal memory](docs/personal-memory.md) for storage, mutation recovery, and
model-context guarantees.

The separate `pnpm smoke:conversation --live` command makes paid synthetic
requests with no database access. It is opt-in and never part of ordinary
verification. See [the command and its limits](docs/conversation-loop.md#opt-in-live-smoke).

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
  backend/         Identity/conversation/memory use cases, adapters, migrations
  api-client/      OpenAPI-generated types and typed fetch client
  memory-command/  Browser-safe literal memory-command parser
scripts/           Isolated integration-test runner
tests/             Unit and real-database integration checks
docs/              Architecture and development notes
openspec/          Configuration for future specification changes
```

Read [the architecture walkthrough](docs/architecture.md) for the service
boundaries and [the development guide](docs/development.md) for migrations,
configuration, and troubleshooting.
