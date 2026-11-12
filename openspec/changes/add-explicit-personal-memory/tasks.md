# Tasks

All tasks start unchecked. This file plans the whole milestone; it does not authorize implementing all checkpoints at once. Implement only the checkpoint the owner next requests, show its evidence, and stop. Commit and archive only when requested.

## 1. Checkpoint 1 — Durable save and inspection through the API

**Demo:** Submit an explicit request through the protected API, read the exact wording and its source, restart the API, and read it again. The browser and model do not use memory yet.

- [x] 1.1 Add the memory domain/application contracts and literal request validation with declared backend entry points; verify tests distinguish the supported direct command from blank, oversized, quoted, and ordinary conversational input, and extend architecture-rule tests to enforce memory core boundaries.
- [x] 1.2 Add versioned Drizzle migrations and a repository for one `memories` table containing ID, owner ID, save request ID, wording, source request, and creation timestamp; verify disposable-PostgreSQL checks cover committed-row acknowledgments, limits, ownership, duplicate accepted requests, conflicting request IDs, and rollback on persistence failure. Use the existing owner lock and reject new mutations while an unexpired conversation attempt runs.
- [x] 1.3 Add authenticated save/list/get/find-by-request HTTP operations and API-module composition without depending on model readiness; regenerate OpenAPI/client output with `pnpm build:services && pnpm api:generate` and verify route validation, session/Origin/CSRF protections, private caching, and execution-disabled access.
- [x] 1.4 Add real migration/API/restart checks using disposable infrastructure and injected models; verify persisted exact wording, original request provenance, saved-row request-ID recovery, no provider invocation, and separation of owner scopes. Do not use the development database or live provider.
- [x] 1.5 Document the API-to-use-case-to-transaction flow and a reproducible synthetic save/read example in `docs/personal-memory.md`; run `pnpm check`, `pnpm test:integration`, strict change validation, and whitespace checks, report limits, and stop for checkpoint 1 review before browser work.

- [x] 1.6 Refactor memory persistence to access only its own table, move save policy into PersonalMemory, and obtain conversation activity and owner locking through module interfaces within one shared transaction. Verify application policy, architecture enforcement, rollback, and cross-connection admission races with pnpm check and pnpm test:integration; confirm no schema/API drift, update the request-flow guide, and stop before checkpoint 2.

## 2. Checkpoint 2 — Composer capture and Memory panel

**Demo:** Type `Remember that I prefer learning through small exercises.`, see **Save memory**, submit once, review the saved wording in the Memory panel, and reload to see the saved entry. Model personalization is still unavailable.

- [x] 2.1 Add browser-owned memory contracts, stateless generated-client operations, session-scoped queries, and saved-request lookup; verify malformed responses are rejected, late replaced-session reads are ignored, and memory details remain private to the current session.
- [x] 2.2 Route the documented composer command to a dedicated memory coordinator while retaining existing draft ownership and ordinary conversation sending; verify the visible Save memory label/payload, model-independent availability, preservation on rejection, and successful clearing of only the submitted draft. A memory save must not create a fake model turn or assistant answer.
- [x] 2.3 Add the focused Memory panel with current entries, original requests, limits, empty/loading/error states, and saved-memory notices using brand tokens/shadcn controls; verify accessible focus and phone/desktop layout, and update the existing Clear history confirmation to explain that explicitly saved memories remain.
- [x] 2.4 Implement explicit saved-request checking and exact-command retry for uncertain saves without automatic replay; verify lost responses, absent saved-request results that do not prove failure, duplicate clicks, conflicting request-ID reuse, logout/expiry, and preservation of an independent next draft using browser API/coordinator behavior tests.
- [x] 2.5 Run phone/desktop save/inspect/reload and AI-disabled scenarios plus `pnpm check`, strict change validation, and whitespace checks; update the walkthrough with browser evidence and the explicit lack of model personalization, then stop for checkpoint 2 review. Repeat database integration only if this checkpoint changes backend behavior.

- [x] 2.6 Simplify save coordination to a TanStack Query mutation with explicit recovery and no automatic retry/offline queue, reuse generated API types, share literal command parsing in a browser-safe package, and limit response validation to transport shape/identity. Verify draft/session/deadline recovery, changed server limits, and unchanged backend save policy; regenerate the numeric-limit OpenAPI contract, run full checks and disposable integration, update the guide, and stop before checkpoint 3.

- [x] 2.7 Simplify the Memory panel at the owner's request to show saved wording with empty/loading/error states and a close action. Remove technical metadata, limits, counters, and implementation notes; retain provenance in the protected API and preserve recovery behavior. Verify web typing/lint, memory tests, and phone/desktop presentation, and update the guide/spec to match.

## 3. Checkpoint 3 — Targeted correction and forgetting

**Demo:** Edit a selected preference, see its replacement wording/source, reject a stale-tab edit, forget the entry, and prove old save/edit requests cannot restore its wording. Do this before enabling memory in model input.

- [x] 3.1 Review a concrete edit/forget recovery design before enabling those operations, then add targeted correction with entry-level stale-edit protection and forgetting without revision history; verify old save/edit/delete requests cannot restore forgotten wording or overwrite newer edits, current/source text is removed on forgetting, and ordinary chat cannot mutate memory. Do not assume the save-only request ID is sufficient after correction or deletion.
- [x] 3.2 Persist/update the conservative context boundary for every memory mutation, apply it to existing conversation context reads, and complete owner-lock coordination with admission, expired attempts, and Clear history; verify historical-text exclusion, cross-process races, busy rejections, deadline release and history-version/sequence-reset handling without deleting visible history.
- [x] 3.3 Add protected PATCH/DELETE contracts and browser edit/forget controls with scoped recovery; regenerate client output and verify named-entry targeting, revision conflicts, busy-state draft preservation, forgotten-request recovery responses without leaked text, and new explicit saves after forgetting.
- [x] 3.4 Add PostgreSQL/HTTP and browser behavior checks for competing tabs, lost edit/delete responses, replay after forgetting, recovery metadata without forgotten text, independent history clearing, and source inspection after history deletion; verify that no background or model extraction path can recreate an entry.
- [x] 3.5 Document exactly what correction/forgetting guarantees, the running-attempt busy behavior, and the planned model-context boundary; run `pnpm check`, `pnpm test:integration`, strict change validation, and whitespace checks, then stop for checkpoint 3 review with model use still disabled.

- [x] 3.6 Apply the owner-approved browser cleanup: remove unused detail caching while preserving stale-list-read cancellation, share bounded execution/lifetime/duplicate-action/error-classification helpers, and provide explicit latest-version review after a conflict without losing the editor draft or silently advancing its revision. Keep save/edit/forget contracts and backend policy unchanged. Verify focused recovery/cache tests, phone/desktop conflict and loss/recovery scenarios, `pnpm check`, strict OpenSpec validation, whitespace, and unchanged generated contracts/migrations; consolidate the affected documentation and stop before checkpoint 4. Database integration is not repeated for this browser-only cleanup.

## 4. Checkpoint 4 — Use the active profile safely in conversation

**Demo:** Save a learning preference, let its original request fall outside recent conversation context, ask for a lesson, and inspect the stub-captured model input containing the active profile. Correct/forget it and prove pre-change exchanges cannot put the old wording into later model context.

- [x] 4.1 Add a conversation-owned profile-read port wired at API composition and a typed personal-context field at the model boundary; verify an empty profile preserves existing behavior and that neither conversation core nor browser code imports memory persistence/framework internals.
- [x] 4.2 Extend context selection to account for serialized active profile plus current input within existing byte limits, then fit eligible completed exchanges; verify full-profile inclusion, historical omission reporting, visible failure without a provider call when required context cannot fit, and unchanged SDK defaults/retry/privacy/web-search configuration.
- [x] 4.3 Integrate profile reads with the context boundary established in checkpoint 3; verify correction/forgetting excludes prior user and assistant restatements, post-boundary exchanges accumulate normally, and Clear history's new sequence/version can enter context. Confirm ordinary replay uses its saved snapshot while intentional retry reads current memory.
- [x] 4.4 Extend localhost SDK/client and composed PostgreSQL tests to assert actual labeled profile input, stable owner/current-entry scoping, literal data treatment, unavailable write tools, and no additional model call for capture; keep all non-stub provider traffic denied and distinguish supplied fixture answers from live model obedience.
- [x] 4.5 Update `docs/personal-memory.md` and relevant conversation guides with one exact request/data trace and visible fresh-context behavior; run `pnpm check`, `pnpm test:integration`, strict change validation, and whitespace checks, then stop for checkpoint 4 review before integrated acceptance.

## 5. Checkpoint 5 — Integrated milestone acceptance

**Demo:** Save -> inspect -> reload -> use -> correct -> use -> forget -> verify exclusion, through the real local authenticated request path on phone and desktop.

- [ ] 5.1 Extend the existing local harness pattern under `output/playwright/integrated/` for memory acceptance using real cookies/CSRF, the production Next.js rewrite, NestJS, disposable migrated PostgreSQL, and the actual SDK with localhost model responses; verify the complete demo at 1440x1000 and 390x844 and record artifacts separately from the earlier conversation results.
- [ ] 5.2 Run integrated loss/recovery, stale-tab correction, generation-versus-mutation busy, expiry/logout, AI-disabled management, context-size rejection, history-clear preservation, and historical-text exclusion scenarios; verify no automatic mutation replay, draft loss, private-state leak to a new session, or stale preference admission.
- [ ] 5.3 Deliver a source-linked reading order and checkpoint report showing implemented versus deferred behavior and remaining model/deployment limits; verify the documented flow matches the browser/API results and uses neither actual personal data nor claims of universal prompt-injection protection.
- [ ] 5.4 Run final `pnpm check`, `pnpm test:integration`, strict OpenSpec validation, whitespace and generated-contract checks; remove disposable acceptance infrastructure, confirm no live provider/development-data operations occurred, and stop for milestone review without committing, archiving, or advancing to automatic memory.

## Workflow follow-up

- Checkpoints 1–4 are implemented and verified with the owner-approved single-table design, capture/inspection, correction/forgetting, explicit recovery, context boundaries, and active profile input; see `docs/personal-memory.md`. Stop for checkpoint 4 review before checkpoint 5. Later checkpoints require an explicit request.
- Before implementation, review the proposed user-facing defaults: literal supported capture syntax, direct saved-memory result without a fake chat turn, explicit memories surviving Clear history, busy rejection during generation, and fresh model context after memory changes.
- Checkpoint 3 begins with a review of mutation recovery before code: no command ledger, tombstone schema, revision history, or profile-wide version is authorized by this simplification. Add only the reviewed fields/behavior needed for correction, forgetting, and context boundaries.
- Before archive, reconcile the shared `personal-memory` capability with `build-personal-knowledge-assistant` and the completed conversation change. Do not mark inferred memory, semantic retrieval, export, background work, or proactivity complete from this narrower milestone.
- Commit/archive only after the owner separately requests those actions and the corresponding verification/review is recorded.
