# Mentor

A personal assistant built incrementally. This first milestone establishes the
services and development workflow. An administrative command now creates the
single owner account. Browser sign-in, database sessions, and logout are now
implemented. Notes, memory, and AI features are later slices.

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
The values in the example are for local development. No OpenAI key is needed.

| Service           | Address                                   | Purpose                                    |
| ----------------- | ----------------------------------------- | ------------------------------------------ |
| Web               | http://127.0.0.1:3000                     | Minimal Next.js starting page              |
| API               | http://127.0.0.1:3001/api/v1/health/live  | API liveness                               |
| API readiness     | http://127.0.0.1:3001/api/v1/health/ready | Database connection and pgvector migration |
| API documentation | http://127.0.0.1:3001/api/docs            | Development OpenAPI explorer               |
| Worker            | http://127.0.0.1:3002/health/live         | Worker process liveness                    |
| Worker readiness  | http://127.0.0.1:3002/health/ready        | Worker database connectivity               |
| PostgreSQL        | 127.0.0.1:55432                           | Persistent development database            |

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
  backend/         Configuration, database adapter, migrations, health module
  api-client/      OpenAPI-generated types and typed fetch client
scripts/           Isolated integration-test runner
tests/             Unit and real-database integration checks
docs/              Architecture and development notes
openspec/          Product plan and tracked milestones
```

Read [the architecture walkthrough](docs/architecture.md) for the service
boundaries and [the development guide](docs/development.md) for migrations,
configuration, and troubleshooting.
