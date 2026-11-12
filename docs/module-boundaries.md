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
| `conversation/model`                 | OpenAI SDK model adapter                                                       |
| `memory`                             | Personal-memory use case, contracts, ports, and domain types                   |
| `memory/persistence`                 | Drizzle memory repository                                                      |
| `memory/schema`                      | Memory table                                                                   |
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
- Identity, conversation, and memory domain code can import only their own domain files.
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

Feature schemas reference identity's owner table through `identity/schema` for
foreign keys. The database schema aggregator imports declared feature schema
entries. Repositories query only their own module's tables. Identity exposes the
owner-lock operation, and conversation exposes activity/context-reset capabilities;
API composition binds these with memory persistence in one shared transaction.
Feature core code imports neither foreign tables nor Drizzle types.

[Context selection](conversation-loop.md#ai-configuration-and-context) remains a
pure application function. SDK and HTTP integration stay in adapters; browser
code uses the generated API client.

## Review and verification

Start with the package export map, then `IdentityModule` to see a real consumer.
Read the lint rule and `tests/unit/architecture-boundaries.test.ts` next. Those
tests exercise the actual ESLint configuration against forbidden and supported
imports, and check Node's rejection of private/root package imports. Integration
tests consume the compiled public package entry points.
