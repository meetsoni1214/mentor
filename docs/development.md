# Development guide

## Configuration

Maintain a root `.env` based on `.env.example`. Backend processes load it through
Node's environment-file support. Existing exported variables take precedence.
The web server loads it in `next.config.ts`; only explicitly public frontend
variables could be bundled, and none are required here.

Database credentials appear in both Compose variables and `DATABASE_URL`; keep
them consistent. Restart services after configuration changes. Changing the
Compose password does not alter a role inside an existing database volume.

| Variable                    | Default/example       | Meaning                                    |
| --------------------------- | --------------------- | ------------------------------------------ |
| NODE_ENV                    | development           | Runtime mode                               |
| HOST                        | 127.0.0.1             | API and worker bind address                |
| API_PORT                    | 3001                  | API listener                               |
| WORKER_PORT                 | 3002                  | Worker health listener                     |
| API_INTERNAL_URL            | http://127.0.0.1:3001 | Web server's API destination               |
| APP_ORIGIN                  | http://127.0.0.1:3000 | Exact browser origin allowed for mutations |
| SESSION_IDLE_SECONDS        | 1800                  | Session idle lifetime                      |
| SESSION_ABSOLUTE_SECONDS    | 86400                 | Maximum session lifetime                   |
| POSTGRES_PORT               | 55432                 | Development database host port             |
| DATABASE_URL                | See `.env.example`    | PostgreSQL connection string               |
| DATABASE_POOL_MAX           | 5                     | Per-process maximum database connections   |
| DATABASE_CONNECT_TIMEOUT_MS | 3000                  | Connection deadline                        |

Invalid backend configuration reports variable names without including values.
Use separate API and worker ports. A database connection is acquired on readiness
requests, so liveness remains available during a database outage.

## Migrations

`packages/backend/drizzle/0000_enable_vector.sql` is a tracked custom migration
that enables the vector extension. Drizzle records it in its migration journal;
running `pnpm db:migrate` again does not reapply it.

When a feature introduces tables:

1. Add its Drizzle schema to `packages/backend/src/database/schema.ts` or export
   it from that file.
2. Run `pnpm db:generate` from the root.
3. Review the generated SQL and metadata.
4. Run `pnpm test:integration` against a disposable database.
5. Run `pnpm db:migrate` against the local development database.

Keep migration SQL and Drizzle metadata together in version control. Do not
replace migrations with schema push. Coordinate future destructive changes with
backups rather than resetting a persistent volume.

## Verification

`pnpm check` covers maintained formatting, ESLint, strict TypeScript, unit tests,
and production compilation. TypeScript's `skipLibCheck` skips third-party
declaration internals; project source remains strictly checked. Generated API
types are excluded from formatting/lint ownership but are still typechecked.

Unit tests cover configuration boundaries, including invalid ports and secret
redaction. They do not need Docker or cloud credentials.

`pnpm test:integration` starts an isolated Compose project with a random
loopback port and temporary PostgreSQL storage. It applies the real migrations,
checks a real vector operation, verifies migration replay is safe, and removes
that test project. It also exercises owner provisioning, password recovery, and
session lifecycle against PostgreSQL. HTTP tests start the compiled API on random
local ports with the test database URL to check authentication and request
protections. Test files run sequentially because they reset the shared disposable
fixtures. The runner never uses the development `DATABASE_URL`.

The test runner needs Docker access and the pgvector image locally available or
pullable. Missing Docker is a failed/unavailable integration check, not a pass.

## Troubleshooting

- **Ignored dependency build scripts:** `pnpm-workspace.yaml` explicitly allows
  the native build scripts used by the toolchain and disables optional NestJS
  donation and Scarf installation-analytics scripts. Keep these decisions in
  version control; do not approve every dependency script automatically.
- **npm cannot be reached:** run `pnpm install` from a terminal with registry
  access. Keep the resulting `pnpm-lock.yaml` with the code; future clean installs
  should use `pnpm install --frozen-lockfile`.
- **Docker socket denied:** confirm `docker info` works in the terminal running
  Compose. Do not make the Docker socket world-writable.
- **Readiness is 503:** check `pnpm db:logs`, connection settings, and whether
  `pnpm db:migrate` completed. Liveness can still return 200.
- **Port already in use:** update the API/worker port and the corresponding
  `API_INTERNAL_URL`; for PostgreSQL update both `POSTGRES_PORT` and `DATABASE_URL`.
- **Missing generated client types:** run `pnpm build:services` followed by
  `pnpm api:generate`.
- **No background jobs execute:** expected at this milestone. The worker is a
  running foundation; capture and queue processors have not been implemented.
- **Sign-in returns 403:** use the exact `APP_ORIGIN` browser address. If you
  prefer localhost, set `APP_ORIGIN=http://localhost:3000` in `.env` and restart
  the API. Do not disable Origin or CSRF checks.
- **Sign-in returns 429:** the shared budget permits five attempts per fifteen
  minutes. Wait for the `Retry-After` interval; restarting the API does not reset it.
- **Sign-in returns 500:** check service health and apply migration
  `0002_owner_sessions.sql` with `pnpm db:migrate`.

## Next milestone

The current slice adds [browser login and sessions](sign-in.md). Administrative
password reset is available with `pnpm owner:reset-password`. A minimal capture
flow remains future work.
The remainder of the OpenSpec roadmap is not authorization to build everything
at once.
