# Tasks

Implementation starts after plan review and an explicit request to apply this change. Groups 1-5 deliver the first usable learning milestone: sign in, save a note or screenshot, and retrieve it in a later conversation. All groups are required for the complete first version.

## 1. Workspace and module foundations

- [ ] 1.1 Create the pnpm workspace with Next.js web, NestJS API, worker, backend modules, and generated-client package; verify clean dependency installation and all application entry points build.
- [ ] 1.2 Configure strict TypeScript, ESLint, Prettier, Vitest, and root build/typecheck/lint/test commands; verify commands run across packages without weakening compiler or lint checks.
- [ ] 1.3 Add PostgreSQL with pgvector through local infrastructure Compose, Drizzle migration commands, and isolated integration-test setup; verify a fresh disposable database migrates successfully.
- [x] 1.4 Create the approved root AGENTS.md and setup/architecture learning notes with module boundaries and commands; verify instructions match the generated workspace and do not claim unimplemented capabilities.

## 2. Private access and responsive shell

- [ ] 2.1 Implement owner provisioning/reset, Argon2id password verification, opaque database sessions, expiry, logout, and session revocation; verify authentication integration tests including reset invalidation and absence of public signup.
  - Progress: owner provisioning, Argon2id verification, browser login, database sessions, idle/absolute expiry, and logout are implemented. Credential reset and authentication runtime/integration verification remain pending. The owner approved login/sessions as a separate slice; this task is not complete.
- [ ] 2.2 Enforce authorization, CSRF/Origin controls, cookie settings, throttling, and private response caching; verify unauthenticated API/file requests and cross-origin mutations are denied without private content.
  - Progress: API routes require sessions by default; mutations enforce Origin and session-bound signed CSRF tokens. Cookie protections, a persistent login budget, and private/no-store API responses are implemented. Runtime verification and future personal-resource ownership checks remain pending.
- [ ] 2.3 Publish versioned OpenAPI errors/session endpoints and generate the typed client; verify frontend consumption and contract generation produce no unexplained drift.
  - Progress: authentication endpoints and fixed error envelopes are generated into the client and consumed by the login screen. Compilation/type checks pass; runtime contract verification remains pending.
- [ ] 2.4 Build accessible phone/desktop login and application navigation with TanStack Query, Zod, and shadcn/ui; verify narrow/wide layouts, keyboard interaction, expired sessions, and recoverable errors.
  - Progress: a native HTML login form and minimal authenticated shell use TanStack Query and Zod, with loading, error, retry, and logout states. Full navigation, the shadcn/ui foundation, and browser acceptance verification remain pending.
- [ ] 2.5 Document provisioning, password reset, HTTPS/same-origin assumptions, and session behavior; verify the documented flow works with a disposable owner and never prints passwords.

## 3. Durable note and image capture

- [ ] 3.1 Add item, private asset, extraction-revision, processing-run, and outbox persistence with repository/file-store ports; verify migrations, private file access, orphan cleanup, and atomic saved acknowledgments.
- [ ] 3.2 Implement idempotent text/image capture with explicit text-save mode, supported MIME checks, configured limits, and preserved originals; verify duplicate submissions, invalid files, and storage failures with unit and integration tests.
- [ ] 3.3 Wire pg-boss dispatch and the separate worker with checkpoints, retries, concurrency limits, and revision checks; verify restart recovery, duplicate dispatch, retry exhaustion, and deletion during a running job.
- [ ] 3.4 Add responsive chat capture and an initial library/detail view with processing states, source preview/download, and retry controls; verify a phone image upload survives a page refresh and an API failure preserves the draft.
- [ ] 3.5 Document the message-to-storage-to-worker path and failure states; verify the learning walkthrough reproduces saving a note and screenshot before AI enrichment is available.

## 4. OpenAI enrichment and searchable source passages

- [ ] 4.1 Implement the OpenAI text/vision and embedding adapters with configurable model IDs, `store: false`, schema validation, deadlines, refusal handling, and redacted telemetry; verify adapter contract tests for successful, malformed, refused, timed-out, and rate-limited responses.
- [ ] 4.2 Implement atomic usage reservations and configurable per-call/daily limits across API and worker, including embeddings and uncertain retries; verify concurrent calls cannot exceed admitted allowances and exhausted limits preserve capture and keyword search.
- [ ] 4.3 Implement screenshot transcription, note enrichment, source-linked summaries, potential-use suggestions, and uncertainty states; verify representative fixtures preserve originals and do not fabricate unreadable text or owner commitments.
- [ ] 4.4 Store source-aware chunks, full-text indexes, and pgvector embeddings with generation metadata; verify keyword/semantic retrieval, owner/deletion filters, dimensionality checks, and a generation switch after reindexing.
- [ ] 4.5 Add the OpenAI processing disclosure, usage/status UI, and model configuration/privacy learning notes; verify the disclosure appears before first AI submission and no credentials enter browser bundles or logs.

## 5. Conversational recall and first working milestone

- [ ] 5.1 Implement persistent conversations and idempotent turns with pending/completed/interrupted/failed states and reconnectable status events; verify restart, duplicate submission, and interrupted stream behavior.
- [ ] 5.2 Implement bounded hybrid retrieval, prompt assembly, answer generation, citation validation, and no-evidence handling; verify real-database retrieval and adversarial model-output fixtures including unknown citation IDs and stale/deleted sources.
- [ ] 5.3 Build chat answers with source references, original-item navigation, history, and retry states; verify the owner can save a screenshot, reopen the app, ask about it, and open supporting evidence on phone and desktop.
- [ ] 5.4 Add a small synthetic evaluation set covering paraphrased queries, similar distractors, no evidence, unsupported claims, and screenshot uncertainty; record retrieval and citation-support results against documented expectations rather than relying only on mocked model outputs.
- [ ] 5.5 Document the retrieve/generate/validate path and its limitations; verify the walkthrough explains where application code controls behavior and where model output remains uncertain.

## 6. Articles, PDFs, and editable organization

- [ ] 6.1 Implement bounded public article fetching with destination validation at connection time, redirect checks, sanitization, and readable-text extraction; verify private IPs, metadata endpoints, DNS changes, redirects, oversized responses, blocked pages, and malicious HTML with controlled fixtures.
- [ ] 6.2 Implement text-PDF extraction with page references and explicit scanned/partial/unreadable states; verify supported, empty, scanned, oversized, truncated, and malformed document fixtures without losing accepted originals.
- [ ] 6.3 Add areas/topics/projects, multi-links, owner corrections, revision conflict checks, filters, and pagination; verify one item appears in multiple views and reprocessing preserves manual corrections.
- [ ] 6.4 Complete capture/library UI for URLs and PDFs and editable summary/organization controls; verify all advertised formats, pending metadata search, source locations, and empty/error states on narrow and wide viewports.
- [ ] 6.5 Document supported formats, limits, article-fetch boundaries, and partial-processing behavior; verify examples correspond to actual UI and API outcomes.

## 7. Editable personal memory

- [ ] 7.1 Add memory entries, provenance links, inference/confirmation states, revisions, rejection records, and explicit owner-statement handling; verify interests, intentions, commitments, conflicts, and sensitive inferences follow the memory specification.
- [ ] 7.2 Implement confirm/edit/reject/delete operations and source/conversation invalidation; verify corrections take precedence, rejected guesses do not return from unchanged evidence, and deleted evidence is excluded from later personalization.
- [ ] 7.3 Build the About You view and contextual confirmation controls; verify the owner can inspect evidence, correct a preference, deactivate a commitment, and observe changed behavior in a subsequent response.
- [ ] 7.4 Document how memory differs from chat history and retrieval, including forgetting and uncertainty; verify examples match the tests and avoid presenting inferences as established facts.

## 8. Controlled proactive assistance

- [ ] 8.1 Implement source-backed suggestion preparation after enrichment and during bounded reviews; verify no-new-information runs produce no forced suggestions and deleted/inactive evidence cannot create candidates.
- [ ] 8.2 Implement deterministic delivery rules for enabled state, frequency caps, quiet hours, timezone, deduplication, snooze, dismissal, and topic mute; verify clock-controlled tests including unchanged evidence, new evidence, repeated workers, and ignored suggestions.
- [ ] 8.3 Implement explicit commitment/reminder confirmation, recurrence, unique due occurrences, edit/cancel behavior, and delivery rechecks; verify ambiguous time handling, timezone/daylight-saving boundaries, restart recovery, and cancellation races.
- [ ] 8.4 Build the Suggestions inbox, reason/evidence view, feedback, and timing controls; verify closed-app work appears on return without duplicate prompt bursts and no external delivery is claimed.
- [ ] 8.5 Add optional scheduled reflections with explicit cadence enablement and documented defaults; verify disabled reflections remain inactive and do not create goals from interests.
- [ ] 8.6 Document preparation versus interruption, in-app delivery limitations, and tuning examples; verify settings change observed behavior in deterministic examples.

## 9. Data ownership and private deployment preparation

- [ ] 9.1 Complete deletion propagation across originals, chunks, embeddings, solely derived memory, suggestions, cached context, and historical answers quoting deleted sources; verify immediate retrieval exclusion and no resurrection from late jobs or prior chat context.
- [ ] 9.2 Implement authenticated portable exports with originals, JSON metadata/memory/conversations, provenance, and expiring archives; verify export completeness and denial of unauthenticated downloads.
- [ ] 9.3 Add API/worker health checks, queue/failure visibility, configuration validation, and secret/content redaction; verify simulated dependency failures are observable without exposing personal data.
- [ ] 9.4 Deliver deployment, backup, restore, and rollback procedures for persistent Linux hosting, HTTPS, private volumes, and model/usage configuration; verify a local rehearsal using synthetic data, including deletion reconciliation after restoring an older backup.
- [ ] 9.5 Document the deployment values still to be supplied: host/domain, secrets, compatible model IDs, AI allowance, storage quota, and backup destination/retention; verify missing critical values fail clearly rather than enabling unlimited AI work or insecure public access.

## 10. Integrated acceptance and handoff

- [ ] 10.1 Run workspace build, strict typecheck, lint, unit tests, and PostgreSQL integration suites after all changes; verify no in-scope build/type/lint blockers and report unresolved test gaps honestly.
- [ ] 10.2 Verify the complete capture -> enrichment -> recall -> correction -> resurfacing -> deletion flow with synthetic notes, screenshots, articles, and PDFs; record results across phone/desktop, provider outage, worker restart, and budget exhaustion.
- [ ] 10.3 Run a bounded live OpenAI smoke/evaluation pass only with configured credentials and usage limits; record model IDs and results, and distinguish live evidence from fixture-based checks.
- [ ] 10.4 Deliver a learning walkthrough and implementation report linking each capability to its code path and verification evidence; verify limitations and remaining deployment requirements are visible and the app is not described as deployed before deployment occurs.

## Workflow follow-up

- Review these planning artifacts and request apply before application scaffolding begins.
- Review a concrete deployment target and costs before provisioning paid infrastructure or publishing the private app.
- Archive only after implementation, verification, and the requested review are complete.
