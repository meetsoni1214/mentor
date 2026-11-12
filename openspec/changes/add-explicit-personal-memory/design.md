# Design

## Context

See proposal.md and docs/memory-evaluation.md for motivation and evaluation. The owner confirmed saving their wording directly, then requested simpler persistence after reviewing checkpoint 1. This design replaces the initial four-table implementation with one `memories` table. Checkpoint 2 implements composer capture, the Memory panel, and scoped save
recovery. Model personalization remains disabled.

Preserve the existing boundaries: framework-independent memory core, Drizzle and HTTP adapters, authenticated session ownership, and PostgreSQL as conversation authority. Conversation admission already locks the owner row. Memory reuses that lock. The browser's draft/recovery coordinator and public session-scope contract remain the integration points for checkpoint 2.

## Goals / Non-Goals

**Goals:**

- Save and inspect exact owner wording with one small durable record.
- Prevent duplicate saves after a lost response without a separate receipt system.
- Keep meaningful validation, ownership, and admission coordination.
- Stop after each reviewed checkpoint.

**Non-Goals:**

- Retain historical wording for revision browsing.
- Add a profile-wide version or command ledger before a demonstrated need.
- Infer memories, rewrite wording, introduce embeddings/vendors, or give the model write tools.
- Claim model obedience or universal prompt-injection protection.

## Decisions

### 1. One table for save and inspection

`memories` contains six columns:

| Column           | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `id`             | Stable memory UUID                                      |
| `owner_id`       | Authenticated owner, with a cascading owner foreign key |
| `request_id`     | Original save UUID, unique together with owner ID       |
| `text`           | Current saved wording                                   |
| `source_request` | Original direct owner request                           |
| `created_at`     | Creation timestamp                                      |

The owner explicitly rejected the additional revision table, owner profile state, and command receipts. Current wording and provenance fit in the same row. The request ID on that row is sufficient for save replay. There is no `updated_at`, entry revision, or profile version in checkpoint 1; add fields only when an implemented operation needs them.

Proposed bounds remain 20 entries, 512 UTF-8 bytes per wording, 4096 bytes of total wording, and 1024 bytes per original request. Per-row bounds exist in PostgreSQL; aggregate capacity is checked under the owner lock. Independent saves do not require a shared expected profile version and can both succeed within capacity.

### 2. Explicit capture and direct results

Accept a case-insensitive, start-of-input `Remember that ` followed by nonblank wording. Trim only payload boundary whitespace; retain the entire original request. Do not scan nested quotes, code blocks, retrieved text, ordinary chat, or model output for commands.

Checkpoint 2 shows **Save memory** and its payload in the composer, calls the dedicated API, and displays a saved-memory notice/panel. It creates no fake conversation turn or model answer and works with assistant execution disabled.

Implemented endpoints under `/api/v1/memory`:

| Operation                  | Contract                                                          |
| -------------------------- | ----------------------------------------------------------------- |
| POST collection            | `{ requestId, sourceRequest }`; returns the saved memory directly |
| GET collection             | `{ entries, limits }`                                             |
| GET `/:entryId`            | Saved memory including original request and timestamp             |
| GET `/requests/:requestId` | The same saved memory found by its original save ID               |

There is no receipt DTO or command endpoint. Generate OpenAPI/client output. Keep browser validation and session-scoped query ownership when adding UI integration.

The literal parser and default bounds live in the browser-safe
`@mentor/memory-command` package and are shared with backend save validation.
Browser DTO types come from the generated API. Runtime browser schemas check wire
shape rather than repeating capacity or wording/provenance policy. Reported
limits are positive numeric fields, not literal enums fixed in the client.

### 3. Save recovery and transaction coordination

Take the owner row lock first. An existing owner/request row returns its saved result when the exact source request matches; changed reuse returns `IDEMPOTENCY_CONFLICT`. Check replay before busy/capacity checks. New requests are rejected while an unexpired conversation attempt runs, using database time. Expired attempts do not block memory; existing deadline checks prevent their late publication.

Check aggregate capacity and insert one row in that transaction. The returned result is acknowledged only after commit. Reads also enforce owner scope. Use existing session/Origin/CSRF protections and private/no-store caching. Memory management is independent of model configuration.

Keep queries with their owning modules. `DrizzleMemoryRepository` only reads/inserts `memories` and returns null for missing reads. `PersonalMemory` owns replay/conflict, busy, capacity, and not-found decisions. Its `MemoryTransactions` port supplies transaction-scoped memory operations and a conversation activity capability without importing ORM types or another module's core.

API composition implements that port by opening one transaction, calling identity persistence's public `lockOwnerForUpdate`, and binding both `DrizzleMemoryRepository` and the public `ConversationActivity` service to it. The conversation service delegates to its own activity reader, which queries conversation-owned tables using database time. Conversation admission reuses the same identity lock function. The lock is never released between the activity check and memory insert; ordinary independent service transactions would reintroduce a race. Architecture lint rejects foreign-schema imports from repositories while allowing module calls at composition boundaries.

For uncertain saves, the browser retains the exact request, looks it up by request ID, and permits deliberate same-request retry. An absent lookup does not prove an in-flight save cannot commit. Never replay a mutation automatically. The browser uses one TanStack Query
mutation with retries disabled and `networkMode: 'always'`, with state derived
from its result instead of a custom observable store. A lifetime signal cancels
delivery on unmount, and a synchronous hook guard blocks duplicate clicks.
Clear private state on session replacement and preserve an independently typed
next draft.

### 4. Correction and forgetting (checkpoint 3)

The owner reviewed the [mutation decisions](../../../docs/personal-memory-mutations.md).
The [personal-memory walkthrough](../../../docs/personal-memory.md#checkpoint-3-correction-and-forgetting)
is the implementation reference for storage, replay/conflict behavior, source
provenance, request flow, and verification. Keep entry revisions, content-free
forgotten records, owner locking, and atomic context-boundary updates. Model use
remains deferred to checkpoint 4.

The owner-approved browser cleanup shares only execution and failure mechanics,
uses one list cache with stale-read cancellation, and requires explicit review of
a newer entry while preserving the edit draft. Save-specific draft handling and
edit-specific checks remain separate. PATCH/DELETE payloads and backend policy
are unchanged by that cleanup.

### 5. Conversation use remains gated

Checkpoint 3 establishes the conversation-owned `context_start_sequence`
boundary on accepted memory changes. Earlier exchanges are omitted from model
context while visible history remains readable. Clear history resets this field
with the sequence counter. See the walkthrough for coordination and migration
behavior.

Checkpoint 4 adds a conversation-owned profile port at API composition and a separate labeled personal-data field at the model boundary. Fit the full profile and current input within existing context bytes, then fit eligible prior exchanges. If required context cannot fit, fail visibly before a provider call. Replay returns saved conversation state; intentional retry uses current memory. Preserve SDK defaults, existing privacy/retry controls, and always-available hosted search with valid model configuration.

### 6. Review checkpoints

1. API save/inspect with one table and request-ID recovery.
2. Composer and Memory panel, with scoped save recovery.
3. Review mutation recovery, then implement targeted correction/forgetting and context boundaries.
4. Use current memory safely in conversation.
5. Integrated phone/desktop acceptance through real local auth/proxy/database/SDK stubs.

Every checkpoint includes its own behavior checks and documentation. Stop for owner review; commit/archive separately when requested.

## Risks / Trade-offs

- Keeping only current wording drops historical revision browsing -> accepted simplification; retain direct provenance for current save inspection.
- Save request IDs live with the memory -> design and review correction/forget recovery before adding those operations.
- Literal command syntax is limited -> show the action and payload before submission.
- Entries can contradict each other -> no semantic deduplication or automatic replacement claim.
- Busy rejection temporarily prevents changing memory -> preserve drafts and use durable deadline checks.
- Future context boundaries omit unrelated recent context -> explain visibly and keep history readable.
- Historical transcripts/backups/provider retention are separate -> describe the actual forgetting scope without broader erasure claims.

## Migration Plan

Checkpoint 1 adds the `0009_explicit_personal_memory` migration and matching Drizzle metadata to create only `memories`. Verification uses disposable infrastructure; do not modify persistent development data or reset volumes. If the prior draft was independently applied to persistent infrastructure, migrate it forward deliberately rather than reusing a changed migration there.

Later checkpoints add only the metadata their reviewed behavior needs through new versioned migrations. Regenerate contracts when routes change. Before archive, reconcile overlapping personal-memory and conversation capability ownership without marking older roadmap features implemented.
