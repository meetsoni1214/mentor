# Design

## Context

See proposal.md for motivation and the five capability specifications for behavior. Inspection found only OpenSpec configuration and empty spec/change inventories; there is no application, dependency manifest, test baseline, or usable Git checkout yet. No migration from existing user data is required.

Confirmed decisions: a privately hosted app for one owner; phone and laptop support; Next.js and NestJS with TypeScript; Drizzle and PostgreSQL; OpenAI cloud processing; email-and-password login without public signup; a root AGENTS.md during implementation. The owner is learning how assistants work, so the implementation should expose understandable boundaries and observable workflows.

The technical details below are proposed for plan approval. Deployment credentials, model IDs, and spending thresholds are configuration, not assumed account access or authorization to purchase hosting.

## Goals / Non-Goals

**Goals:**
- Deliver complete learning milestones: capture and recall first, then broader ingestion, personal memory, and proactive assistance.
- Keep originals and structured state authoritative in the owner's deployment; send only bounded task context to OpenAI.
- Make AI output a validated suggestion. Application code owns authorization, storage, scheduling, deletion, and cost limits.
- Keep framework dependencies at module boundaries and make failures visible and recoverable.

**Non-Goals:**
- No distributed microservices, general autonomous computer agent, model training, or agent framework in the first version.
- No guarantee that a valid structured model response is factually correct.
- No external notification delivery, app-store distribution, or multi-user tenancy in this change.

## Decisions

### 1. One repository, three application processes

Use a pnpm workspace containing `apps/web` (Next.js), `apps/api` (NestJS HTTP), and `apps/worker` (background process sharing backend use cases). Keep shared API types/client in `packages/api-client`; share backend domain/application modules in a package consumed by API and worker. Use a small package structure and avoid wrappers without a meaningful boundary.

Next.js owns presentation. NestJS owns authentication, persistence, assistant use cases, and authorization. Organize backend capabilities as identity, library, memory, conversation, and proactivity modules. Core use cases depend on repository, model, file-store, queue, and clock interfaces; adapters implement those interfaces using Drizzle, OpenAI, and the selected infrastructure.

Alternative: a Next.js-only backend is simpler to deploy but conflicts with the chosen separate backend and obscures the learning boundary. Microservices would add operational work without benefit for one owner.

```text
Phone / laptop
      |
      v
HTTPS reverse proxy
      |                    |
      v                    v
Next.js UI            NestJS API
                           |
                 +---------+-----------+
                 |                     |
                 v                     v
        PostgreSQL + pgvector    Private file volume
                 ^                     ^
                 |                     |
                 +---- Worker ---------+
                         |
                         v
                    OpenAI API
```

API and worker can both call the model adapter, but all slow enrichment and scheduled work run through the worker. Production targets a persistent Linux deployment capable of running these processes, PostgreSQL, and a private volume. Local Docker Compose provides database infrastructure; application processes run with pnpm.

### 2. Backend-owned password authentication

Provision one owner using an interactive administrative command; do not put the password in CLI arguments, source, seed fixtures, or logs. Store an Argon2id password hash. Use opaque random session tokens in Secure, HttpOnly, SameSite cookies and hashed token records in PostgreSQL. Sessions have configurable idle and absolute expiry. Logout revokes the session; a documented administrative credential reset revokes every session.

Expose web and `/api/v1` under one origin via the reverse proxy. Enforce CSRF tokens and Origin validation on mutations, generic login errors, throttling, and authorization on each resource and file request. Personal responses use private/no-store caching and authenticated file streaming. No public static directory contains uploads or exports.

Alternative: JWT plus rotating refresh tokens is reasonable for distributed clients, but database sessions simplify immediate revocation for this one-origin application. Third-party identity would require a service the owner did not choose.

### 3. PostgreSQL owns structured state; a private volume owns original files

Use Drizzle migrations, foreign keys, transactions, and explicit indexes. Main records:

| Record | Purpose |
| --- | --- |
| Owner, session, preferences | Identity, timezone, controls, and limits |
| Item, source asset, extraction revision | Originals, source metadata, processing state, and versioned interpretation |
| Area, topic, project, item links | Multiple editable connections without duplicating items |
| Chunk, embedding generation | Searchable source passages with offsets/page references and model metadata |
| Memory entry, evidence link, rejection | Stated/inferred information, provenance, revisions, and feedback |
| Conversation, message, citation | Persistent turns, bounded context, and evidence references |
| Suggestion, feedback, reminder, occurrence | Proactive candidates, suppression, and explicit schedules |
| Outbox event, processing run, usage reservation | Durable dispatch, recovery, limits, and operational evidence |

Use UUIDs and an owner identifier even though public multi-user access is excluded. Store uploads under generated keys outside the web root. Write a file completely before committing its asset record; garbage-collect abandoned uploads after a grace period. A save acknowledgment follows the committed item and durable event, not an optimistic UI update. Private files and database both require backup and restore.

The first release uses a private persistent filesystem volume shared by API and worker behind a FileStore interface. Object storage can replace it later. This deliberately constrains the initial deployment to persistent storage rather than ephemeral serverless filesystems.

### 4. Durable, bounded processing

Use pg-boss for PostgreSQL-backed work queues and scheduling. Commit an outbox event in the same transaction as each capture or state change; a dispatcher submits it with a unique key and records dispatch. A repeated dispatch is safe because consumers enforce uniqueness and check current item revisions.

Pipeline: save -> fetch/extract -> classify/summarize -> chunk/embed -> publish ready or needs-review. Keep stage checkpoints, attempt counts, timeouts, retry backoff, and a terminal failure state. Job payloads carry IDs and revisions rather than copies of personal content. Workers check deletion, ownership, and revision before expensive work and again before publishing results. Do not claim exactly-once external model calls: a crash after a provider response can require a billed retry.

Alternative: an in-memory queue loses accepted work on restart. Redis is unnecessary for the first single-owner deployment; pg-boss uses the database already required. Bound worker concurrency and polling so background work does not starve chat.

### 5. Ingestion that preserves evidence

Text notes are saved explicitly through a save control. Attachments and standalone article links are capture inputs; ordinary conversational text remains conversation unless saved. Allow a caption on an attachment without creating a second source item.

Start with configured limits visible in the UI: 20 MiB per image/PDF, 100,000 characters per note, a 50-page text-PDF processing cap, bounded article response size, redirect count, decompressed size, and fetch time. Preserve accepted originals when extraction is incomplete; say which portion was processed. Reject files over upload limits before claiming success. Validate actual content type, generate filenames, sanitize rendering, and serve risky originals as downloads.

For article URLs, permit HTTP(S) on approved public ports, resolve and validate every destination and redirect, reject private/reserved addresses and cloud metadata routes, and ensure the connection uses the validated address. Do not execute site JavaScript or supply browser cookies. Fetch article content and extract readable text; keep the submitted URL, final URL, title, and fetch time. Inaccessible content stays as a saved link with an honest status.

Extract text and page locations from text PDFs locally. Use OpenAI vision for screenshot transcription/description, retaining the image as the source of truth. Treat transcriptions as fallible. Scanned PDFs remain needs-review rather than implying OCR support. Classifications are versioned suggestions; owner overrides win during reprocessing.

### 6. OpenAI integration and retrieval

Implement an OpenAI adapter using the Responses API for text/vision and structured extraction, plus embeddings for semantic search. These capabilities are documented in the [Responses API](https://developers.openai.com/api/reference/responses/overview) and [embeddings guide](https://developers.openai.com/api/docs/guides/embeddings). Use configured chat/vision/embedding model IDs; validate that the configured capabilities and embedding dimensions match before indexing. Pin tested SDK versions during implementation.

Keep conversation state in PostgreSQL. Use foreground model requests with `store: false`; do not use hosted conversations, file search, or provider background jobs in this version. Send image bytes and bounded extracted passages rather than creating persistent provider file objects. Disclose that this does not promise zero provider retention; the applicable controls and exceptions are documented in [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Chunk by source boundaries with stable item/revision/page or offset references. Combine PostgreSQL full-text ranking and pgvector semantic results, merge ranks, filter deleted/stale content, and supply only a bounded selection to answer generation. Drizzle documents [pgvector integration](https://orm.drizzle.team/docs/guides/vector-similarity-search). Use exact vector search initially; add approximate indexes only when measured library size warrants them. An embedding model/dimension change creates a new generation and reindexes before switching reads.

Answers include server-assigned evidence IDs. Validate every citation against the retrieved set and current authorization, and mark general suggestions separately. Recheck deletion/revision before committing an answer. Display citation excerpts alongside originals; identifier validation alone does not establish factual support, so evaluate claim support with curated examples.

Start with an explicit retrieve -> generate -> validate workflow whose stages are observable. No unbounded agent loop is needed for this scope. Log operational stages, durations, model identifiers, usage, and error codes; do not log raw private prompts, passwords, source contents, or hidden model reasoning.

### 7. Personal memory is editable application state

Each entry has a category (preference, interest, intention, commitment, or context), origin (owner-stated/inferred), confirmation state, timestamps, revision, and evidence links. An owner correction has priority over inference. Require confirmation for inferred health or relationship attributes. Retrieved source text is never an instruction to change the profile.

Commitments and reminders use a visible confirmation flow; saving an article never creates them. For ambiguous dates or timezone, ask before confirming a schedule. Proposed starter areas reflect the conversation but remain editable: engineering/entrepreneurship, relationships, fitness, communication, and open exploration. They do not encode personality traits or diagnoses.

Rejected inferences have suppression records keyed to the proposition and unchanged evidence; these contain only the minimum needed for suppression and are removed on a complete data deletion. Deleting sole evidence invalidates derived unconfirmed memories. Independently confirmed owner statements can remain with the owner confirmation as their evidence. Conflict handling never overwrites an owner statement silently.

### 8. Proactivity is preparation plus controlled delivery

Run bounded reviews after enrichment and periodically to find undelivered candidates. A model can suggest relevance, but deterministic code applies enabled status, evidence freshness, mute/dismiss/snooze state, deduplication, quiet hours, and frequency limits before surfacing anything. There is no requirement to generate a suggestion per review.

Proposed initial settings, editable by the owner: proactive preparation enabled; at most one unsolicited in-app prompt per day; quiet hours 21:00-09:00 in the confirmed timezone; scheduled weekly reflections disabled until enabled. The UI confirms timezone rather than assuming the server timezone. Inbox entries can accumulate quietly; known repeats are suppressed. A reminder explicitly requested for a quiet-hour time is shown in the inbox when due, with interrupting prompts deferred until quiet hours end.

Suggestions show evidence and a reason for relevance, with useful/dismiss/snooze/mute controls. Novelty is based on changed evidence or context, not merely rephrased model text. Ignored suggestions are not escalated into repeated prompts. Reminders have unique occurrence IDs and recheck active state at delivery. UTC timestamps plus the owner's IANA timezone support recurrence and daylight-saving rules.

First-version delivery is in-app only. Background workers continue while the browser is closed, but no phone push, email, or messaging delivery is promised. On return, the owner sees an aggregated inbox, not a replay of popups. External notification delivery is a separate future change.

### 9. API, UI, and cost boundaries

Publish versioned REST/OpenAPI endpoints for sessions, captures/items, library links, memory, conversations/turns, suggestions, reminders/preferences, and exports. Generate the typed frontend client from that contract. Use consistent error envelopes, cursor pagination, idempotency keys for creation, and optimistic revision checks for edits. Use SSE for turn/status events with a persisted status endpoint for reconnection; do not confuse lost streaming connections with lost saved data.

Use TanStack Query for remote state, Zod at browser/model boundaries, and shadcn/ui components. Main destinations are Chat, Library, About You, and Suggestions, with settings for controls. Support mobile upload and responsive layout; defer native share-sheet integration. Include accessible labels, keyboard focus, empty/loading/error/retry states, and a visible distinction between saved and processed.

The server enforces bounded context, output, attempts, concurrency, and a daily AI token allowance using atomic reservations before calls. Reserve an upper bound, reconcile known usage afterward, and conservatively account for uncertain failed attempts. Embeddings count toward limits. Record approximate cost only when configured model prices are available; do not promise that local estimates exactly match provider billing. When the allowance is exhausted, preserve capture and keyword search and pause paid work with a visible reason. Background calls require explicitly configured limits; no unlimited default.

### 10. Deletion, export, and operations

An item tombstone immediately excludes it from search, prompts, and suggestions. Cleanup removes assets, extracted revisions, embeddings, solely derived unconfirmed memories, caches, and dependent suggestions. Conversation deletion also invalidates solely derived memory. Historic assistant answers quoting deleted content must be redacted or invalidated and excluded from future context; citation links alone becoming unavailable is insufficient. Late workers cannot recreate deleted material.

Exports run as authenticated jobs and contain originals plus documented JSON for metadata, memory, messages, and provenance; temporary export archives have a bounded lifetime. Backups have a disclosed retention period. Restore procedures reapply deletion records newer than the restored snapshot so deleted material does not silently return.

Provide health/readiness checks for API and worker, queue lag and terminal-failure visibility, structured redacted logs, configuration validation, backup/restore procedures, and deployment instructions for HTTPS and persistent volumes. No production deployment or hosting purchase is performed by the planning workflow.

## Risks / Trade-offs

- AI relevance, OCR, and memory can be wrong -> preserve sources, label inferences, support corrections, and test representative retrieval cases.
- A cloud model processes personal content -> disclose selected data flows, minimize context, keep keys server-side, and document provider retention separately from local deletion.
- Private URL fetching can reach unintended infrastructure -> validate destinations and redirects at connection time, enforce response limits, and use adversarial tests.
- Background retries can duplicate calls or increase cost -> durable checkpoints, unique effects, bounded retries, and atomic usage reservations.
- A single persistent host is an availability dependency -> backups, supervised processes, restore drills, and explicit failure states; no high-availability claim.
- Helpful suggestions can become interruptions -> deterministic limits and feedback, in-app delivery first, no urgency inferred solely from model wording.
- Scope can grow toward a general agent -> finish the five specified capabilities before adding computer control or external-app actions.

## Migration Plan

1. After plan approval, create the workspace/tooling and AGENTS.md, then apply initial Drizzle migrations to an isolated development database.
2. Deliver authenticated note/image capture and later source-backed recall as the first working milestone. Explain the request, persistence, job, and retrieval path in learning notes.
3. Add article/PDF ingestion and editable organization; then personal memory and proactivity. Keep all task checkboxes incomplete until the corresponding behavior is verified.
4. Verify builds, strict types, lint, focused unit/integration tests, source-grounding examples, mobile/desktop flows, restart recovery, and deletion behavior.
5. Configure the chosen Linux host, domain, credentials, model IDs, limits, and backup retention before any private deployment. Provision the owner without default credentials and run an authenticated smoke check with synthetic content.
6. Roll back application releases to the previous compatible version. Prefer forward-fix migrations; take coordinated database/file backups before destructive schema changes. Restore into an isolated target, reconcile deletions, verify, and then switch traffic.

## Open Questions

These are deployment values and tuning choices, not missing architecture decisions:
- Which Linux host/domain and backup destination will be used?
- Which available OpenAI model IDs and daily token/spending allowances fit the owner's account and budget? Resolve against current model documentation before enabling live calls; changing embedding dimensions requires the planned reindex process.
- What backup retention and file-storage quota should the private deployment use?
