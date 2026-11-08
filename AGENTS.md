# Mentor development guidance

## Current milestone

Bootstrap, owner provisioning/password recovery, and browser authentication are
implemented with local verification. The active change is
`add-assistant-conversation-loop`: one continuous conversation per owner, with
no thread creation or selection. Group 1, conversation persistence and run
lifecycle, and the four architecture follow-ups are implemented. The current
review checkpoint is the complete SSE attempt-retry slice (tasks 3.3f–3.3g),
following backend retry commit 04f6c8a and the earlier browser streaming, Markdown,
and submission-state refactor checkpoints. Stop for review before Clear history,
broader interaction/auth acceptance, or investigation.
Task 2.3 completed API-side composition of the conversation use case,
Drizzle repository, and pinned Agents SDK/Responses adapter, including persistence
of available SDK-reported usage for unsuccessful attempts. Tasks 2.2a–2.2c
implemented normal SDK execution, cancellation, explicit privacy/retry settings,
and local HTTP-stub verification. The stricter budget policy and request subclass
were removed at the owner's request. Use the SDK default iteration limit and
standard per-call output setting; do not reintroduce cumulative budgets or hooks.
History remains readable/clearable
while execution is disabled. Application/database tests use an injected fake;
adapter and composed lifecycle tests use the actual SDK and official client with
non-stub traffic denied. ConversationModule exposes authenticated assistant status,
history, submit, retry, and clear-history routes under /api/v1. HTTP tests use
the production app/guard with an injected model fake and disposable PostgreSQL.
OpenAPI and client types are regenerated. README, .env.example, and the conversation
guide document the composed request path, server settings, privacy/disclosure,
and foreground-recovery limits. ConversationLoop validates application commands
with Zod; controllers own HTTP decoding and use shared HTTP presenters for response
mapping. JSON routes call the use case directly; ConversationStreamService in the
HTTP adapter owns streaming event mapping, response errors, and cleanup. Task 3.1 adds the generated-client-backed browser
conversation API, browser-owned response validation, shared CSRF handling, and
session/history guards for late requests. Conversation contracts/errors, stateless
HTTP operations, request scope, and TanStack Query integration are separate modules.
Pass SessionState.scope() to createConversationQueries for protected UI integration;
conversation depends on the public auth/session-scope.ts contract. Use the adapter's
query options; new-version head reads must complete while obsolete pages are discarded.
Authentication uses SessionState per QueryClient for replacement and expired-session
cleanup. Task 3.2 replaces the signed-in placeholder with a monochrome workspace:
owner messages on the right, assistant responses on the left, versioned older-message
pagination, run details, and per-response context notes. The owner removed the
OpenAI disclosure line and Privacy & context section beneath the composer; do not
restore that footer section. Cloud-processing details remain in documentation.
The owner requested
black, white, and neutral gray instead of green. The owner has now approved the
sending slice: the composer preserves drafts on rejected admission, retains the
same request ID/payload for uncertain delivery, and offers explicit recovery.
Poll head history every two seconds while delivery is unresolved or a running
attempt has no matching live stream; pause background polling. A 15-second confirmation wait exposes
recovery without cancelling or automatically replaying backend work. Drafts are
in memory only and clear on unmount/session replacement/history-version change.
One query
adapter is shared by a workspace keyed by session generation. See
docs/conversation-ui-plan.md for component responsibilities and browser evidence.
The sending slice is implemented as a separate commit checkpoint. The owner has approved backend
streaming slice 1: add an opt-in POST /api/v1/conversation/turns/stream alongside
the compatible JSON route. Use application-owned admission/text progress and
SSE accepted/text_delta/result/error events. Only committed final results enter
history/context; provisional text stays ephemeral. Replays return persisted
snapshots without another runner or stream attachment. Reader disconnect or bounded
output buffering detaches delivery without cancelling admitted execution.
Browser streaming uses generated-client POST with CSRF and validates SSE events
against browser-owned contracts. Acceptance clears only the submitted draft and
stops the confirmation timer; completion never clears the next draft. Provisional
text stays outside query history. Committed snapshots update the head cache,
terminal history supersedes partial text, and session/history replacement detaches
the reader and clears private state. Disconnect, idle timeout, or invalid events
recover through history without automatic POST replay. Stream framing and temporary
display memory are bounded independently of model execution. Full recovery/proxy
acceptance remains slice 3. Stop after browser streaming for review; commit when
requested. Clear history, full interaction/auth acceptance, and public-web
investigation remain later checkpoints. Task 3.3 stays open until all of its behavior and
acceptance checks are complete. Do not add Clear history in this slice.
The older `build-personal-knowledge-assistant` change remains
a broader historical roadmap, not the next implementation scope.

Task 2.7 adds POST /api/v1/conversation/turns/{turnId}/retry/stream with the existing
retry body and shared SSE event shapes. ConversationLoop.retry forwards an optional
application progress observer to the existing execution path; the HTTP streaming
service shares delivery, error mapping, and cleanup between submit and retry.
JSON retry remains compatible. An intentional retry keeps the original message
and creates a fresh attempt key; its accepted event matches attempt.requestId,
not the original turn.requestId. Replay returns saved snapshots without another
runner or live attachment. Browser retry controls now use that endpoint, validating
turn/version and the attempt request ID. Unresolved state owns a typed send or
retry command in the existing pure state/coordinator split. Retry preserves the
independent composer draft; only new-message acceptance clears submitted text.
History acceptance matches retry attempt IDs, and an older terminal attempt cannot
settle a new unresolved retry. Healthy streams pause polling; unresolved delivery
or running replays/disconnects recover through history. Only explicit recovery
may resend the exact original retry command. Eligibility and duplicate-click
guards complement authoritative backend admission.
Task 2.7 verification passes pnpm check (335 unit/contract tests and production
build) and pnpm test:integration (104 disposable PostgreSQL/HTTP/SDK checks), plus
strict OpenSpec and whitespace checks. Generated API changes add only the retry
streaming route. No live model calls or database migrations were needed.
Tasks 3.3f–3.3g pass pnpm check (377 tests and production build), the same 104
integration checks, and 28 synthetic phone/desktop scenarios. Browser fixture
authentication/storage/execution do not complete real-cookie/deployed-proxy
acceptance. Browser changes remain a review checkpoint; commit when requested.

## Architecture

- Keep browser branding in `apps/web/src/brand/`: `brand.ts` for name/monogram/metadata,
  `brand-logo.tsx` for reusable logo/lockup, and `tokens.css` for brand colors and
  semantic design tokens. Import these in features; do not copy names, logos, or
  raw color codes. Prefer shadcn primitives from `components/ui/` for controls,
  notices, and disclosures. Tailwind/shadcn roles map to the same brand tokens;
  do not introduce a separate palette. See `docs/design-system.md` for conventions.
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
