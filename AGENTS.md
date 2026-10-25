# Mentor development guidance

## Current milestone

Bootstrap, owner provisioning/password recovery, and browser authentication are
implemented with local verification. The active change is
`add-assistant-conversation-loop`: one continuous conversation per owner, with
no thread creation or selection. Group 1, conversation persistence and run
lifecycle, and the four architecture follow-ups are implemented. The current
review checkpoint is task 2.2a: framework-independent whole-run budgets and
model-port limits, including redacted model-call configuration. History remains
readable/clearable while execution is disabled. Tests use an injected fake provider;
the budget policy is ready for enforcement at the later SDK request boundary.
The OpenAI adapter, API composition and
protected conversation endpoints, UI, and public-web investigation remain later
checkpoints. Stop after a verified focused slice for review; commit when requested.
The older `build-personal-knowledge-assistant` change remains
a broader historical roadmap, not the next implementation scope.

## Architecture

- Use TypeScript, pnpm, Next.js, NestJS, Drizzle, and PostgreSQL.
- Next.js owns presentation. Authentication authority, persistence, and use
  cases belong in the backend.
- Keep domain/use-case code independent of NestJS, HTTP, and ORM APIs as those
  features are added. Framework adapters belong at the boundaries.
- Share backend modules through `packages/backend`; the browser must not import
  that package. Use `packages/api-client` for the API contract.
- Generate client types from the API OpenAPI document; do not hand-edit generated
  output. Regenerate with `pnpm build:services && pnpm api:generate`.
- Use versioned migrations. Do not use schema push against persistent data.
- Use Docker Compose for local infrastructure; run apps with pnpm.

## Working practices

- Honor the user's currently approved milestone and existing work.
- Make focused commit checkpoints as work progresses, as requested by the user.
  If repository metadata is not writable, report that limitation and never
  claim a commit was created.
- Explain the request/data flow and important tradeoffs in plain language.
- Keep strict typing, meaningful validation, and explicit error handling.
- Do not add unexplained `any`, suppress compiler errors, or weaken lint to pass.
- Keep secrets and personal content out of commits, logs, and browser bundles.
- Do not overwrite `.env` or remove database volumes without explicit intent.
- Document what is implemented separately from what is planned.
- Use the build-production-web-apps skill for new full-stack builds or explicitly
  requested production-readiness work; not for isolated routine edits. Follow
  its clarification and plan-approval workflow for new scope.

## Verification

- `pnpm check`: formatting, lint, type checking, unit tests, and production build.
- `pnpm test:integration`: disposable PostgreSQL/pgvector container, real
  migrations, and database checks; never the development database.
- Report unavailable checks and their reasons. Do not mark OpenSpec tasks complete
  when their specified validation has not been performed.
- Live OpenAI access is not part of bootstrap verification.
