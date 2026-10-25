# Tasks

This change is the current conversation-loop implementation scope. The older `build-personal-knowledge-assistant` change remains a broader historical roadmap. Unmet tasks there stay open. Each group is a reviewable commit checkpoint; document actual evidence and limitations as work progresses.

## 1. Conversation state and run lifecycle

- [x] 1.1 Add framework-independent conversation, turn, attempt, source/activity, and repository/model port types under packages/backend; verify strict service compilation and focused unit tests of allowed state transitions and latest-turn-only retries.
- [x] 1.2 Add Drizzle schemas and a versioned migration for one conversation per owner with a unique owner constraint, monotonic history version, idempotent submission/attempt keys, dependent messages/results; verify fresh disposable-database migration, rerun safety, singleton uniqueness, foreign keys, dependent-content deletion, and update the existing migration-count assertion.
- [x] 1.3 Implement automatic singleton resolution, atomic admission, same-key replay/conflict detection, owner-wide concurrency, ordered turns, and explicit retries using an injected provider fake; verify concurrent real-database first-use tests resolve one conversation, admit once, never duplicate messages, and reject old/completed-turn retries.
- [x] 1.4 Implement deadline reconciliation, conditional completion, owner-filtered paginated history, and versioned history clearing that retains the singleton; verify fake-clock unit tests plus real-database timeout/completion, clear/completion, stale-tab submission/retry/clear, and retry races cannot publish stale output, resubmit cleared input, delete newer messages, or resurrect content.
- [x] 1.5 Begin docs/conversation-loop.md with the state/data flow and documented recovery limits; update AGENTS.md's milestone to the current slice; verify the examples match the implemented backend and create a focused commit after relevant unit and disposable-database checks pass.

## 2. Bounded model execution and protected API

- [x] 2.1 Add redacted server-only AI environment validation, automatic readiness from valid model/key configuration, and finite limits; verify missing/invalid config, disabled execution with readable history, and boundary values without printing secrets or modifying an existing .env.
- [ ] 2.2 Add the pinned official OpenAI SDK and a Responses adapter with store:false, explicit bounded continuous-conversation history, output/deadline limits, disabled SDK retries, and normalized outcomes; verify local HTTP-stub contract tests for successful multi-turn input, context truncation, timeout, refusal, incomplete/malformed output, rate limits, and redacted provider failures without real API calls.
- [ ] 2.3 Wire the use case to the real model adapter, known-usage recording, and stable failure categories; verify concurrent-run rejection, restart recovery, explicit retries, and configuration/provider failures making no unauthorized calls.
- [ ] 2.4 Add authenticated assistant status and singleton conversation read/submit/retry/clear-history routes with versioned OpenAPI DTOs and assistant-specific errors, omitting create/list/select endpoints; regenerate using pnpm build:services && pnpm api:generate and verify actual HTTP authorization, ownership, CSRF/Origin, no-store, invalid inputs, idempotent replay, and absence of secrets in responses.
- [ ] 2.5 Extend docs/conversation-loop.md, README.md, and .env.example with the request path, disclosure, required model configuration, finite defaults and foreground-recovery limits; run pnpm check and pnpm test:integration, confirm generated contracts have no unexplained drift, and create a focused verified commit.

## 3. In-app conversation workspace

- [ ] 3.1 Add a generated-client-backed frontend conversation API with runtime validation and generalized expired-session handling; verify late responses after logout/history clearing cannot repopulate private query state and no backend package is imported into the browser.
- [ ] 3.2 Replace the signed-in placeholder with one continuous transcript opened automatically after sign-in, older-message pagination, composer, cloud-processing notice, bounded-context notice, and run details; verify keyboard use, readable status announcements, empty/loading/config-disabled states, and phone/desktop layout without horizontal overflow, with no New conversation button, thread list, titles, or topic/day reset.
- [ ] 3.3 Implement draft preservation, submission-key reconciliation, polling while running, explicit retry, and Clear history in privacy settings with stale-version protection; verify browser acceptance with a synthetic provider for a contextual follow-up, long history that remains browsable beyond model-context limits without asking to start over, reload during work, dropped POST response, temporary API failure, interrupted run, history clearing during generation, stale-tab replay rejection, and uninterrupted continuation after returning another day or changing topic.
- [ ] 3.4 Extend auth browser acceptance to session expiry/logout while conversation requests are in flight; verify sign-in recovery does not resubmit, private caches/drafts clear, browser local/session storage has no transcript, and existing sign-in/logout behavior still works.
- [ ] 3.5 Document the in-app walkthrough and browser evidence in docs/conversation-loop.md, distinguishing accepted from unsent drafts and fixture output from live output; run relevant checks and create a focused verified commit.

## 4. Read-only investigation and complete-loop acceptance

- [ ] 4.1 Add runtime-controlled public-web tool availability and disclosure of assistant-selected search, letting the model decide when to use the built-in web_search tool within finite max_tool_calls; verify provider fixtures support both searched and unsearched responses when available, omit unavailable tools, expose no per-turn flag/toggle, and never claim a search without observed activity.
- [ ] 4.2 Normalize provider-observed search activity and citation annotations into bounded persisted records; render answer text safely with separately validated HTTP(S) source links and no raw HTML or promoted invented links; verify unsafe URLs, malformed annotations, unknown output shapes, and fabricated sources are rejected or labelled honestly.
- [ ] 4.3 Add synthetic Railway-notice and adversarial email/page fixtures; verify conversation continuation, distinction between public evidence and unknown account exposure, no fabricated monitoring/rotation claims, and no write-capable tools or credential access despite embedded instructions. Document that fixture enforcement tests do not establish universal model truthfulness.
- [ ] 4.4 Run pnpm check, pnpm test:integration, and integrated phone/desktop browser acceptance through conversation, investigation, source inspection, refresh/recovery, history clearing, singleton continuity, and auth loss; record actual results and unavailable checks, keep unverified tasks open, and create a focused verified commit.
- [ ] 4.5 Provide an opt-in live smoke command using configured credentials/model and bounded synthetic requests; verify ordinary tests never call OpenAI, document the command and limits, and record the exact live model/results if run or clearly record that live verification remains unavailable. Never treat stubbed search as live evidence.

## Workflow follow-up

- Present the proposal, two capability specs, design, and tasks for review. The proposal workflow ends at that checkpoint; implementation uses openspec-apply-change for this named change after the user's next implementation instruction.
- During apply, use these task groups as reviewable commit checkpoints; do not expand into email observation, long-term personal memory, action execution, or the older roadmap's remaining groups.
- Before archive, reconcile overlapping conversation capability ownership and milestone ordering with the older roadmap; do not mark its retrieval, streaming, export, or background work complete based on this narrower change.
- Archive only after implemented behavior, available verification, limitations, and the requested review are recorded.
