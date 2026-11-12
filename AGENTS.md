# Mentor development guidance

## Current product

Mentor implements owner provisioning/password recovery, browser authentication,
one continuous conversation per owner, streamed answers, explicit retry, Clear
history, hosted web search with validated citations, and explicit personal memory.
Memory supports composer capture, inspection, correction, forgetting, and active
wording in model context. Conversation and memory milestones have local integrated
phone/desktop acceptance using real authentication, disposable PostgreSQL, and
localhost model responses. Live provider behavior and deployed TLS/proxy behavior
remain unverified.

Use the implementation guides in `docs/` and the current code for scope and
behavior. Completed checkpoint plans and the superseded product roadmap have been
removed. Future features require a new request; do not infer authorization from
historical milestones. Commit only when requested.

## Architecture

- Use TypeScript, pnpm, Next.js, NestJS, Drizzle, and PostgreSQL.
- Next.js owns presentation. Authentication authority, persistence, and use cases
  belong in the backend. The worker currently provides health checks only.
- Keep domain/use-case code independent of NestJS, HTTP, ORM, and provider SDK
  APIs. Framework adapters belong at the boundaries.
- Share backend modules through declared `packages/backend` entry points. The
  browser must not import that package; use `packages/api-client` for API contracts
  and `packages/memory-command` for literal memory-command parsing.
- Repositories access only their own module's tables. Coordinate across modules
  through explicit capabilities within shared transactions. Memory changes and
  conversation admission use the same identity-owned owner lock.
- Controllers decode/authenticate/delegate. `ConversationStreamService` in the
  HTTP adapter owns SSE lifecycle, mapping, response errors, and cleanup.
- Generate OpenAPI/client output with `pnpm build:services && pnpm api:generate`;
  do not hand-edit generated files.
- Use versioned migrations, never schema push against persistent data. Use Docker
  Compose for local infrastructure and pnpm for applications.
- See `docs/architecture.md` and `docs/module-boundaries.md` for module ownership.

## Conversation and memory rules

- PostgreSQL is the durable conversation authority. Do not add SDK sessions,
  provider Conversations, or `previous_response_id` chains without a new decision.
  Provisional deltas never become durable history or future context.
- Preserve SDK default iterations and standard per-call output settings. Do not
  reintroduce cumulative budgets, execution hooks, or a redundant AI enable flag.
- Valid key/model configuration always offers hosted web search. Do not add a
  separate search flag. The model chooses whether to search; only observed search
  activity and validated annotations become recorded evidence.
- Keep raw SDK state, queries, page contents, and reasoning ephemeral. Generated
  prose links stay inert; clickable citations use validated saved-answer positions.
- Session/history replacement detaches readers and clears obsolete private state.
  Drafts stay in memory only. Healthy streams pause polling; unresolved delivery
  or running work without a matching stream uses foreground history polling.
- Never automatically replay uncertain mutations. Explicit recovery first reads
  current state and retains the exact original command/key/version. Retry creates
  a fresh attempt on the latest unsuccessful turn and preserves composer drafts.
- Clear history uses one version-captured confirmation. After confirmed clearing,
  hide obsolete content and read authoritative history. A same-version read does
  not prove a pending clear failed. Saved memories survive clearing.
- Memory is explicitly saved literal wording. New saves/edits/forgets atomically
  advance the conversation context boundary while preserving visible history.
  New memory mutations are busy during an unexpired conversation attempt.
- Keep entry revisions, mutation identity, and content-free forgotten records so
  stale operations cannot overwrite newer wording or resurrect forgotten entries.
  Send only current active wording to the model as labeled data.
- Synthetic fixture answers verify transport, roles, permissions, evidence, and
  persistence; they do not establish live model truthfulness or universal
  prompt-injection protection. Incident examples belong in fixtures.

## UI conventions

- Keep branding in `apps/web/src/brand/`: `brand.ts`, `brand-logo.tsx`, and
  `tokens.css`. Use shared tokens and shadcn primitives from `components/ui/`;
  do not introduce copied branding or a separate palette.
- Preserve the black, white, and neutral-gray direction. See
  `docs/design-system.md` for conventions.
- Keep copy and controls minimal. The Memory panel shows saved wording and useful
  edit/forget/recovery controls, without technical metadata, limits, or counters.
- Do not restore the cloud-processing line or Privacy & context footer beneath the
  composer. Processing details belong in documentation.
- Use one direct confirmation for a destructive action; avoid redundant dialogs
  and success notices when the resulting state is clear.

## Working practices and verification

- Honor the user's requested scope and preserve unrelated local work.
- Remove stale or superseded plans, specs, and docs.
- Explain request/data flow and tradeoffs in plain language. Prefer descriptive
  operations and clear steps over complex coordination.
- Keep strict typing, meaningful validation, and explicit errors. Do not add
  unexplained `any`, suppress compiler errors, or weaken lint.
- Test visible behavior and stable boundaries. Keep incident-specific examples in
  fixtures and test general behavior.
- Keep secrets and personal content out of commits, logs, and browser bundles.
  Do not overwrite `.env` or remove database volumes without explicit intent.
- `pnpm check` covers formatting, lint, types, unit tests, and production build.
- `pnpm test:integration` uses disposable PostgreSQL/pgvector with real migrations,
  never the development database. Model adapter checks use localhost stubs and
  deny other provider traffic.
- Report unavailable checks and limitations. Ordinary verification never invokes
  paid live smoke execution; `pnpm smoke:conversation --live` requires explicit
  live-call authorization.
- Use `build-production-web-apps` for new full-stack builds or explicitly requested
  production-readiness work, with its clarification/plan-approval workflow. Do not
  invoke it for small fixes, minor UI changes, or isolated routine edits.
