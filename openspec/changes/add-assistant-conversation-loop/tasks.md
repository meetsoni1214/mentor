# Tasks

This change is the current conversation-loop implementation scope. The older `build-personal-knowledge-assistant` change remains a broader historical roadmap. Unmet tasks there stay open. Use the focused review checkpoints below; document actual evidence and limitations as work progresses and commit when requested. The owner requested removal of the stricter budget implementation in favor of normal SDK behavior. Tasks 2.2a–2.2c track that simplification; earlier verification is historical until the revised tasks pass their checks.

## 1. Conversation state and run lifecycle

- [x] 1.1 Add framework-independent conversation, turn, attempt, source/activity, and repository/model port types under packages/backend; verify strict service compilation and focused unit tests of allowed state transitions and latest-turn-only retries.
- [x] 1.2 Add Drizzle schemas and a versioned migration for one conversation per owner with a unique owner constraint, monotonic history version, idempotent submission/attempt keys, dependent messages/results; verify fresh disposable-database migration, rerun safety, singleton uniqueness, foreign keys, dependent-content deletion, and update the existing migration-count assertion.
- [x] 1.3 Implement automatic singleton resolution, atomic admission, same-key replay/conflict detection, owner-wide concurrency, ordered turns, and explicit retries using an injected provider fake; verify concurrent real-database first-use tests resolve one conversation, admit once, never duplicate messages, and reject old/completed-turn retries.
- [x] 1.4 Implement deadline reconciliation, conditional completion, owner-filtered paginated history, and versioned history clearing that retains the singleton; verify fake-clock unit tests plus real-database timeout/completion, clear/completion, stale-tab submission/retry/clear, and retry races cannot publish stale output, resubmit cleared input, delete newer messages, or resurrect content.
- [x] 1.5 Begin docs/conversation-loop.md with the state/data flow and documented recovery limits; update AGENTS.md's milestone to the current slice; verify the examples match the implemented backend and create a focused commit after relevant unit and disposable-database checks pass.

## 2. Bounded model execution and protected API

- [x] 2.1 Add redacted server-only AI environment validation, automatic readiness from valid model/key configuration, and finite limits; verify missing/invalid config, disabled execution with readable history, and boundary values without printing secrets or modifying an existing .env.
- [x] 2.2a Remove the custom RunBudget policy, Responses request subclass, strict raw-response/answer-size checks, AI_MAX_MODEL_CALLS configuration, model-port budget fields, and selector overhead callback. Keep existing application admission, initial transcript bounds, deadline, and privacy settings. Verify no active code or tests depend on the removed policy and check the simplified configuration/port contracts.
- [x] 2.2b Use one Mentor Agent and Runner with the standard pinned OpenAIResponsesModel, application-owned context, store:false, disabled automatic retries, and disabled tracing/export. Accept the SDK default iteration limit, standard per-call output setting, final output, errors, and aggregate usage without custom request hooks or cumulative budget accounting. Keep production tools unregistered and normalize outcomes without exposing raw SDK state.
- [x] 2.2c Verify the real SDK/provider adapter through localhost HTTP-stub contract tests: contextual follow-up, storage/state fields, no automatic retries, cancellation before/during/between steps, SDK errors/refusals, redacted failures, default iteration behavior, per-call output settings, SDK usage, and no trace/export traffic through shutdown. Use synthetic test-only tools; deny non-stub traffic. Update documentation, .env.example, and AGENTS.md to describe SDK defaults and their limits, then run pnpm check and pnpm test:integration. Stop for review before API composition or production tools; commit when requested.
- [x] 2.3 Wire the use case to the Agents SDK adapter and persist available SDK-reported usage, including unsuccessful attempts where supplied, without a second accounting system. Keep stable SDK/provider failure categories. Verify concurrent-run rejection, idempotent replay starting no second runner, restart recovery without auto-resume, explicit retry starting a fresh SDK run, history clearing versus multi-step completion, and configuration/provider failures making no unauthorized calls. Extend persistence mappings without SDK types or raw run storage; add a versioned migration only if required.
- [x] 2.4 Add authenticated assistant status and singleton conversation read/submit/retry/clear-history routes with versioned OpenAPI DTOs and assistant-specific errors, omitting create/list/select endpoints; regenerate using pnpm build:services && pnpm api:generate and verify actual HTTP authorization, ownership, CSRF/Origin, no-store, invalid inputs, idempotent replay, and absence of secrets in responses.
- [x] 2.5 Extend docs/conversation-loop.md, README.md, and .env.example with the composed SDK/API request path, disclosure, required model configuration, application settings and SDK defaults, tracing policy, and foreground-recovery limits; run pnpm check and pnpm test:integration, confirm generated contracts have no unexplained drift, and provide the focused application/API checkpoint for review and a commit when requested.

- [x] 2.6 Implement backend streaming slice 1: application-owned admission/text progress, opt-in pinned SDK streaming, and protected SSE submission alongside compatible JSON submission. Generate documented event contracts and verify early text delivery, persisted final results/usage, same-key replay without another runner, JSON admission errors, post-header redaction, provider failure after deltas, deadline/clear suppression of late output, observer/reader failure isolation, and bounded buffering using unit tests, local HTTP stubs, and disposable PostgreSQL/HTTP checks. Run pnpm check and pnpm test:integration; document limits and stop for review before browser streaming.
- [x] 2.7 Add explicit attempt-retry SSE using POST /api/v1/conversation/turns/{turnId}/retry/stream with the existing retry body. Forward an optional application progress observer through ConversationLoop.retry into the existing execution path and reuse HTTP-adapter event mapping, framing, buffering, error handling, and cleanup. Preserve JSON retry and existing admission/replay/privacy rules. Regenerate OpenAPI/client types with pnpm build:services && pnpm api:generate. Verify committed retry acceptance, early text, saved results/usage, failed/interrupted outcomes, same-key running/completed replay without another runner or stream attachment, conflicts/older/completed turns, session/Origin/CSRF/version rejection before SSE, redacted post-header errors, disconnect/observer isolation, and deadline/clear suppression using application tests, real SDK localhost stubs, and disposable PostgreSQL/HTTP tests. Do not mark complete without the specified checks; continue into the browser retry tasks for the single review checkpoint.

## 3. In-app conversation workspace

- [x] 3.1 Add a generated-client-backed frontend conversation API with runtime validation and generalized expired-session handling; verify late responses after logout/history clearing cannot repopulate private query state and no backend package is imported into the browser. Keep HTTP, contracts/errors, request scope, and query-cache responsibilities separate; verify a read discovering a newer history version completes while obsolete pages are removed.
- [x] 3.2 Replace the signed-in placeholder with one continuous transcript opened automatically after sign-in, older-message pagination, composer, per-response bounded-context notes, and run details; verify keyboard use, readable status announcements, empty/loading/config-disabled states, and phone/desktop layout without horizontal overflow, with no New conversation button, thread list, titles, or topic/day reset. Use the approved monochrome palette with owner messages right and Mentor replies left; keep sending explicitly disabled for this checkpoint. Omit the cloud-processing and Privacy & context footer at the owner's request; document those details instead.
- [x] 3.3 Implement draft preservation, submission-key reconciliation, polling while running, explicit retry, and Clear history from the header with stale-version protection; verify browser acceptance with a synthetic provider for a contextual follow-up, long history that remains browsable beyond model-context limits without asking to start over, reload during work, dropped POST response, temporary API failure, interrupted run, history clearing during generation, stale-tab replay rejection, and uninterrupted continuation after returning another day or changing topic.
- [x] 3.3a Implement browser streaming slice 2: generated-client SSE submission and browser-owned event validation, acceptance separate from completion, ephemeral provisional rendering, saved terminal-state precedence, session/history reader cleanup, and polling only for unresolved delivery or running attempts without a matching live stream. Verify framing/UTF-8, early text, final/failed results, replay, draft preservation, disconnect recovery, and stale-event suppression with deterministic tests and synthetic phone/desktop browser checks; run pnpm check and stop for review before full slice-3 acceptance.
- [x] 3.3b Establish the browser submission refactor baseline: document events, state transitions, effects, and the behavior-test mapping in docs/conversation-ui-plan.md using design decision 7.1. Run pnpm exec vitest run --config vitest.config.ts apps/web/tests; retain assertions for request identity/counts, draft lifetimes, acceptance through history, saved-terminal precedence, explicit-resend failures, failed history checks, and session/history invalidation. Add only missing behavior/race coverage and record the baseline and unavailable checks before changing production state handling.
- [x] 3.3c Introduce state/submission-state.ts with pure typed state and named lifecycle transitions; keep the original SubmitInput inside unresolved-delivery states instead of a separate nullable pending field, and keep the next editable draft independent of an accepted live response. Refactor conversation-submission.ts to own HTTP/history/cache effects, confirmation waiting, subscriptions, delivery generation, and cancellation while preserving the existing UI snapshot/hook boundary where possible. Verify browser delivery/stream tests, strict types, stable getSnapshot references between changes, history-confirmed acceptance preserving a live stream, next-draft preservation, and obsolete delivery suppression; update the documented ownership map with the implemented structure.
- [x] 3.3d Complete failure and notice simplification within the two-module design: classify failures once, apply policy using confirmed acceptance and initial-send versus explicit-resend context, replace display-string comparisons with typed notice codes/safe parameters, and replace ambiguous boolean arguments with named operations or explicit options. Preserve session/history/delivery guards, same-key reconciliation, timer/polling policy, stream bounds, and effect ordering. Verify known initial rejection preserves the draft, inconclusive resend failures retain unresolved identity while definitive conflicts keep their existing handling, failed checks never resend, duplicate confirmation/final completion never clears the next draft, and session/history replacement clears private state without replay; keep the transition map aligned with the behavior tests.
- [x] 3.3e Verify and present the complete browser submission refactor checkpoint: run pnpm check, strict OpenSpec validation, and git diff --check; confirm no unexplained generated API drift. Repeat focused synthetic phone/desktop checks for acceptance and next drafts, lost confirmation and same-key recovery, disconnect and saved completion, and session/history cleanup without duplicate writes. Record actual results/limitations in docs/conversation-ui-plan.md and a concise current-state file-reading order plus one send/disconnect/recovery trace in docs/conversation-loop.md, separating historical evidence from the current entry point. Report database integration as not rerun unless the implementation touches backend/database behavior; make no live model calls. Stop for review before remaining task-3.3 features, backend refactoring, tool configuration cleanup, query-adapter contract removal, or search; commit only when requested.
- [x] 3.3f Implement browser SSE attempt retry using design decision 7.2: generated-client POST and shared bounded SSE validation with retry-specific history-version/turn/attempt-request-ID checks; a typed send-or-retry operation in the existing pure state/coordinator split; Retry response on only the latest failed/interrupted turn with availability, unresolved-delivery, running-attempt, and double-click guards. Preserve drafts on all retry outcomes, preserve previous attempts, publish committed snapshots, and keep provisional text ephemeral. Confirm acceptance from the target attempt's request ID, never the original turn key or an older terminal attempt. Preserve healthy-reader/no-polling behavior, saved-terminal precedence, confirmation/idle bounds, exact-command explicit recovery, no POST after a failed check, safe NOT_FOUND/NOT_RETRYABLE handling, inconclusive replay-failure handling, and session/history/delivery guards. Verify normal send behavior remains intact and no second coordinator, state-machine dependency, or private browser persistence is introduced.
- [x] 3.3g Verify and present the complete SSE retry checkpoint (2.7 and 3.3f): run pnpm check, pnpm test:integration, strict OpenSpec validation, and git diff --check; inspect generated API changes for only the intended retry route. Add behavior tests and synthetic phone/desktop acceptance for eligibility, one message/multiple attempts, double clicks, early/final/failed responses, healthy streams without polling, current/next-draft preservation, mismatched event identities, history-confirmed acceptance retaining a healthy reader, lost confirmation with exact-key recovery, failed checks without replay, disconnect/reload and saved completion, older-attempt non-settlement, another-tab races, and session/history cleanup with obsolete callbacks. Record actual evidence and limits in docs/conversation-ui-plan.md and docs/conversation-loop.md, including a retry/disconnect/recovery trace, and update AGENTS.md's current milestone. No live model calls, existing .env edits, or development-data operations. Stop for review before Clear history, broader task-3.3/3.4 acceptance, or investigation; commit only when requested.
- [x] 3.4 Extend auth browser acceptance to session expiry/logout while conversation requests are in flight; verify sign-in recovery does not resubmit, private caches/drafts clear, browser local/session storage has no transcript, and existing sign-in/logout behavior still works.
- [x] 3.5 Document the in-app walkthrough and browser evidence in docs/conversation-loop.md, distinguishing accepted from unsent drafts and fixture output from live output; run relevant checks, present the focused verified checkpoint for review, and commit when requested.

The owner approved the sending portion of task 3.3 as a separate review slice:
draft preservation, stable submission identity, explicit delivery recovery, and
polling. Explicit model-attempt retry, Clear history, and full acceptance remain
follow-ups. Task 3.3 must remain unchecked until those requirements are also met.

The owner approved tasks 3.3b–3.3e as one behavior-preserving browser submission
refactor checkpoint before adding model-attempt retry or Clear history controls.
These four tasks are performed in order and reviewed together; completed sending
and streaming tasks stay checked. The refactor adds no state-machine dependency,
transport/storage contract, or backend execution change. Removing reserved tool
configuration or query-adapter behavior remains a separate decision. Passing this
checkpoint does not complete the broader acceptance required by tasks 3.3–3.5.

The next planned checkpoint is explicit attempt retry with SSE, tasks 2.7 and
3.3f–3.3g, performed in that order and reviewed together. The owner selected live
SSE acceptance/text/results instead of JSON plus polling as the normal retry
experience. Polling remains the fallback for unresolved delivery and running
attempts without a matching healthy stream. This slice keeps the original user
message, uses a fresh key for each intentional retry, preserves the independent
composer draft, and reconciles uncertain retry delivery using that attempt's key.
No retry task is marked complete by this planning update. Task 3.3 remains open
after retry until Clear history and its remaining acceptance checks are verified.

The owner subsequently requested task 2.7 alone before browser implementation.
That backend checkpoint is implemented and verified: pnpm check passes all 335
unit/contract tests and the production build; pnpm test:integration passes all
104 disposable PostgreSQL/HTTP/SDK checks. Generated contracts add only the retry
streaming route. See docs/conversation-loop.md for evidence and environment limits.
The owner then requested committing that checkpoint and starting the next slice.
Backend task 2.7 is committed as 04f6c8a. Browser tasks 3.3f–3.3g are implemented
and verified: pnpm check passes all 377 unit/contract tests and the production
build; pnpm test:integration passes all 104 checks; 28 synthetic phone/desktop
scenarios pass. Generated API output has no additional drift. Evidence and limits
are recorded in docs/conversation-ui-plan.md. Stop here for browser review; the
browser retry checkpoint is complete. Broader task 3.3 remains open.

## Clear history review checkpoint

The owner approved this focused follow-up after SSE retry. Broader tasks 3.3–3.5
remain open until their complete acceptance requirements pass.

- [x] 3.3h Implement Clear history from the header with explicit confirmation, the existing versioned DELETE operation, pending/uncertain mutation guards, exact-version explicit recovery, draft and provisional-state cleanup after confirmed clearing or history replacement, authoritative history reload, and rejection of obsolete callbacks. Preserve drafts on definitive initial rejection. Keep confirmation presentation separate from the existing pure submission state and coordinator; add no backend contract or migration.
- [x] 3.3i Verify Clear history with behavior tests and synthetic phone/desktop browser acceptance for cancellation, double clicks, disabled execution, active send/retry, dropped responses, failed/same-version checks, exact-version retry, stale tabs, newer messages, session loss, and late reads/events/results. Run pnpm check, strict OpenSpec validation, and git diff --check; inspect generated-contract drift. Document actual evidence and limitations; rerun database integration if backend behavior changes or an unresolved backend concern requires it. Stop for review before broader interaction/auth acceptance or investigation; commit only when requested.

Clear history tasks 3.3h–3.3i are implemented and verified: pnpm check passes all
397 unit/contract tests and the production build, including 177 browser checks;
30 synthetic phone/desktop scenarios pass. Strict OpenSpec and whitespace checks
pass, and generated contracts have no drift. No backend/database code changed;
integration was not rerun. Synthetic authentication/SSE does not establish real
cookies or deployed-proxy acceptance. See docs/conversation-ui-plan.md for limits.
Stop here for review. Broader tasks 3.3–3.5 and investigation remain open.

## 4. Read-only investigation and complete-loop acceptance

The owner selected 4.1 as the next implementation slice after reviewing the
conversation foundation. Implement and verify hosted-search registration only,
then stop for review. Citation/activity normalization and UI remain 4.2, and
broader investigation/browser/live verification remain 4.3–4.5. The owner requested
that search always be available with valid AI configuration, without a separate
enable flag; no existing `.env` is changed.

The owner then requested committing 4.1 (e46b4e5) and implementing the next slice,
4.2. Complete its source/activity normalization, persisted citation positions,
safe inline/source-list presentation, and focused verification, then stop for
review before 4.3–4.5. Keep always-available search; no new enable flag is needed.

The owner committed 4.2 as b4d4404 and selected 4.3 as the next slice. Add the
synthetic notice/email/page fixtures and focused permission/context checks, then
stop for review before 4.4–4.5. Honest prose supplied by local fixtures is not
live model-quality or universal truthfulness evidence.

- [x] 4.1 Register only the SDK-supported hosted web-search tool through Responses under runtime-controlled availability and disclose assistant-selected search. Let the SDK/model choose when to search, using supported per-request settings and the application deadline, without custom cumulative budgets. Verify searched/unsearched SDK fixtures, unavailable tools omitted, no other production tools, no per-turn toggle, and no search claimed without observed activity.
- [x] 4.2 Normalize provider-observed search activity and citation annotations exposed through SDK results into bounded persisted records; preserve required continuation items only within the active run. Render answer text safely with separately validated HTTP(S) source links and no raw HTML or promoted invented links; verify unsafe URLs, malformed annotations, unknown output shapes, and fabricated sources are rejected or labelled honestly.
- [x] 4.3 Add synthetic Railway-notice and adversarial email/page fixtures; verify conversation continuation, distinction between public evidence and unknown account exposure, no fabricated monitoring/rotation claims, and no write-capable tools or credential access despite embedded instructions. Document that fixture enforcement tests do not establish universal model truthfulness.
- [x] 4.4 Run pnpm check, pnpm test:integration, and integrated phone/desktop browser acceptance through conversation, investigation, source inspection, refresh/recovery, history clearing, singleton continuity, and auth loss; record actual results and unavailable checks, keep unverified tasks open, present the focused verified checkpoint for review, and commit when requested.
- [x] 4.5 Provide an opt-in live smoke command using configured credentials/model and bounded synthetic requests; verify ordinary tests never call OpenAI, document the command and limits, and record the exact live model/results if run or clearly record that live verification remains unavailable. Never treat stubbed search as live evidence.

Task 4.1 is implemented and verified with the real pinned SDK/official client
against local HTTP stubs. After the owner's always-available-search revision,
formatting, lint, types, 408 unit/contract tests, and 107 disposable
PostgreSQL/HTTP/SDK integration checks pass. Initial registration's `pnpm check`
stopped at the known Turbopack subprocess-port restriction; its Webpack production
build passed. The frontend build was not repeated for the configuration-only
revision. Strict OpenSpec and whitespace checks pass without generated-contract or
lockfile drift. Search is always available with valid AI configuration while 4.2
citation/activity handling remains open. The registration slice does not infer activity from permission or persist raw
search metadata. Prompt policy requires actual supporting search evidence, but
fixtures do not prove universal model truthfulness. No live calls, browser
acceptance, migrations, or existing `.env` edits were performed. Stop for review;
4.2–4.5 and the earlier broad acceptance boxes remain open. Commit when requested.

Task 4.2 is implemented and verified: `pnpm check` passes all 455 unit/contract
tests and the default Turbopack production build; 109 disposable PostgreSQL/HTTP/SDK
checks and 12 synthetic phone/desktop scenarios pass. Strict OpenSpec and
whitespace checks pass. Generated API changes add only optional citation
positions; existing JSON storage needs no migration. Sources/activity are now
normalized from observed SDK evidence, bounded and persisted with completed
answers, and shown as validated inline citations plus visible source links.
Ordinary generated links stay inert. No live provider calls, existing `.env`
edits, or development-data operations were performed. The synthetic browser
checks do not complete real-cookie/deployed-proxy acceptance or prove universal
truthfulness. Stop for review here; 4.3–4.5 remain open. Commit when requested.

Task 4.3 is implemented and verified: `pnpm check` passes all 461 unit/contract
tests and the production build; all 112 disposable PostgreSQL/HTTP/SDK integration
checks pass. Strict OpenSpec and whitespace checks pass without generated-contract,
lockfile, or migration drift. Six SDK cases and three composed cases use named
synthetic notice/email/page fixtures. Unsupported credential, rotation, and
monitoring calls are rejected; public evidence and contextual follow-ups are
preserved. Honest answers are canned, and a deliberately false prose case confirms
that evidence records are not fabricated without claiming arbitrary prose is
semantically filtered. The hostile page reader is test-only, not a production
tool or a test of provider-internal hosted retrieval. No browser acceptance, live
provider calls, actual incident investigation, existing `.env` edits, or
development-data operations were performed. Stop for review before 4.4–4.5;
commit only when requested.

## Complete-loop acceptance checkpoint (4.4–4.5)

The owner authorized 4.4 and 4.5 together, keeping the solution general-purpose.
The 4.3 notice stays a test example only; stale exact prompt-phrase assertions were
removed while context roles, tool permissions, evidence, persistence, and rejected
credential/action calls remain covered. Production behavior is unchanged.

On 2026-11-08, `pnpm check` passes all 467 unit/contract tests and the default
production build; all 112 disposable PostgreSQL/HTTP/SDK integration checks pass.
Twenty-four integrated Chromium scenarios pass at 1440×1000 and 390×844 through
real local cookies/CSRF, the production Next.js rewrite, NestJS, disposable
PostgreSQL, and the actual SDK with a localhost provider stub. These close the
remaining local acceptance in 3.3–3.5. Strict OpenSpec and whitespace checks pass
without generated API, lockfile, or migration drift.

`pnpm smoke:conversation --live` provides the opt-in configured-model synthetic
multi-turn/public-search check with deadlines and per-request limits. Six ordinary
subprocess tests intercept all provider fetch traffic; no paid run was performed.
Live provider compatibility/search/answer quality and deployed TLS/proxy behavior
remain unverified. See docs/conversation-loop.md for the walkthrough, exact
verification scope, artifacts, command, and limits. No existing .env or development
data was changed. Stop here for review; commit/archive only when requested.

## Workflow follow-up

- Present the proposal, two capability specs, design, and tasks for review. The proposal workflow ends at that checkpoint; implementation uses openspec-apply-change for this named change after the user's next implementation instruction.
- All tasks in this change are implemented and locally verified through 4.4–4.5, including overlapping browser acceptance 3.3–3.5. Review the complete-loop checkpoint before committing or archiving. Live provider and deployed TLS/proxy results remain unverified as documented. Do not expand into email observation, long-term personal memory, action execution, SDK approval/session persistence, specialist handoffs, or the older roadmap's remaining groups.
- Before archive, reconcile overlapping conversation capability ownership and milestone ordering with the older roadmap; do not mark its retrieval, streaming, export, or background work complete based on this narrower change.
- Archive only after implemented behavior, available verification, limitations, and the requested review are recorded.
