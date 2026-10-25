# Module entry points and import rules

The backend package exposes specific entry points in `packages/backend/package.json`.
The former `@mentor/backend` root export has been removed. Node and TypeScript
reject unsupported package paths, so consumers cannot import arbitrary `src/`
or `dist/` files through the package name.

| Entry point under `@mentor/backend/` | Responsibility                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `identity`                           | Session, provisioning, and password-reset use cases, errors, and session types |
| `identity/crypto`                    | Password hashing and session-token adapters                                    |
| `identity/persistence`               | Drizzle identity repositories                                                  |
| `identity/schema`                    | Owner, session, and login-budget tables                                        |
| `conversation`                       | Conversation use case, contracts, ports, and domain types                      |
| `conversation/persistence`           | Drizzle conversation repository                                                |
| `conversation/schema`                | Conversation, turn, and attempt tables                                         |
| `config`                             | Validated runtime environment readers                                          |
| `config/ai`                          | Server-only AI readiness, credentials, and finite run limits                   |
| `database`                           | Database connection types, construction, and migration runner                  |
| `database/nest`                      | Nest database module and service                                               |
| `health`                             | Nest health module                                                             |
| `http`                               | Public-route metadata and decorator                                            |

For example, API composition imports `Sessions` from `@mentor/backend/identity`,
`DrizzleSessionRepository` from `@mentor/backend/identity/persistence`, and
`DatabaseService` from `@mentor/backend/database/nest`. The provider factory still
constructs the same dependencies. HTTP adapters import the use case and its
types without pulling concrete persistence adapters through the same barrel.

## Enforced dependency direction

`scripts/eslint/architecture.mjs` supplies the local `architecture/import-boundaries`
rule, enabled by `eslint.config.mjs`. It reads the package export map to identify
public source files, avoiding a separate list of internal entry points.

- Web code and the API client cannot import backend implementations, API/worker
  code, Nest, Drizzle, or PostgreSQL clients. The browser uses `@mentor/api-client`.
- Identity and conversation domain code can import only their own domain files.
  Application code and the core entry files can import their own domain and
  application files. Application validation may also use Zod. Frameworks,
  adapters, runtime configuration, and other feature internals are excluded.
- Backend modules use declared entry files when crossing into another module.
  Relative imports within a module remain available. Backend code cannot import
  application-process code from `apps/`.
- API, worker, and integration tests use supported package subpaths. Relative
  imports into backend source/build files are rejected. Focused unit tests can
  still import the implementation under test without making it public.
- Backend tooling, including `drizzle.config.ts`, may import a declared public
  source entry before compiled output exists.

The rule checks static imports, re-exports, literal dynamic imports, TypeScript
import types, and literal `require` calls, including type-only imports. Relative
paths are normalized before checking. Computed module paths and custom aliases
are outside this rule's scope; the repository does not introduce either here.
The rule enforces import direction, not arbitrary runtime behavior or a complete
dependency-cycle analysis. New feature cores and new aliases need corresponding
policy review when introduced.

## Keep the shared database dependency explicit

Conversation persistence imports the owner table through `identity/schema`.
The database schema aggregator uses the identity and conversation schema entries.
These are infrastructure dependencies: the existing owner foreign key and owner
row lock remain necessary for transaction behavior. Neither feature core imports
those tables. Adding a forwarding service would not remove this coupling.

This checkpoint changes exports and import paths only. It preserves SQL,
migrations, transaction boundaries, HTTP contracts, and use-case behavior.
The subsequent [context-selection slice](conversation-loop.md#retained-history-and-model-context)
extracts a pure application function within these same boundaries. Provider,
HTTP, and UI integration remain later feature work.

## Review and verification

Start with the package export map, then `IdentityModule` to see a real consumer.
Read the lint rule and `tests/unit/architecture-boundaries.test.ts` next. Those
tests exercise the actual ESLint configuration against forbidden and supported
imports, and check Node's rejection of private/root package imports. Integration
tests consume the compiled public package entry points.

The incoming checkpoint passed lint and 93 unit tests. Its recorded full-gate
and isolated PostgreSQL results were 93 unit tests and 50 integration tests.

Verified on 2026-10-25 after this checkpoint:

- `pnpm check` passes outside the sandbox: formatting, lint, strict types, 130
  unit tests (including 37 boundary checks), contract generation, and production
  builds.
- `pnpm test:integration` passes all 50 database/HTTP tests using the compiled
  public entry points. Its disposable PostgreSQL container and network were
  removed after the run.
- Generated OpenAPI/client files and versioned migrations are unchanged.
  `openspec validate add-assistant-conversation-loop --strict` passes.

The existing Next.js 16.4.0 security advisory remains unresolved and an upgrade
is still recommended. Its initial notice stops the build; the repeated full
gate completes with the warning. Browser acceptance and live model access were
not rerun for this import-only checkpoint.
