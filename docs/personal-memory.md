# Explicit personal memory

Mentor saves literal wording only when the owner explicitly requests it. The
composer, Memory panel, protected API, correction/forgetting, recovery, and active
profile in model context are implemented. Saving memory creates no conversation
turn and makes no model call. Memory management works with AI execution disabled.

## Use it

1. Type `Remember that I prefer learning through small exercises.` in the
   composer and choose **Save memory**. Ordinary chat and quoted material are not
   automatically scanned for memories.
2. Open **Memory** to inspect saved wording. Select an entry to edit, then **Save**.
   **Forget** is inside the editor and uses one confirmation. The header close
   control or Escape closes the panel and restores focus.
3. Ask a normal question. The next attempt receives all active wording as labeled
   personal data, alongside bounded eligible conversation context.

Every new save/edit/forget starts fresh model context while preserving visible
history. The composer/editor explain this effect. Clear history preserves saved
memories. The panel shows wording and useful controls, without technical metadata,
capacity counters, or implementation notes; provenance remains in the API.

## Storage and policy

Migrations [0009](../packages/backend/drizzle/0009_explicit_personal_memory.sql)
and [0010](../packages/backend/drizzle/0010_memory_mutations.sql) define one
`memories` table and the conversation context boundary.

| Column                     | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `id`, `owner_id`           | Entry identity and owner scope                   |
| `request_id`               | Original save key, unique per owner              |
| `text`, `source_request`   | Current wording and the request that supplied it |
| `revision`                 | Entry-level stale-edit/delete protection         |
| `last_mutation_request_id` | Recognition of the latest accepted mutation      |
| `forgotten_at`             | Content-free forgotten state                     |
| `created_at`               | Stable creation ordering                         |

Limits are 20 active entries, 512 UTF-8 bytes per wording, 4,096 bytes of total
wording, and 1,024 bytes per source request. PostgreSQL checks per-row bounds;
`PersonalMemory` checks aggregate capacity under the owner lock. Fresh request IDs
can deliberately save repeated wording; there is no semantic deduplication,
automatic extraction, revision history, or separate profile/receipt table.

The shared parser accepts a case-insensitive start-of-input `Remember that ` with
nonblank wording. It trims only payload boundaries, preserving internal spelling,
spaces, and newlines. NUL and unpaired surrogates are rejected. Editing currently
constructs the same explicit command from plain editor text. `sourceRequest`
therefore describes the latest wording operation, not an immutable original save.

Forgetting nulls both wording and source. IDs, revision, and timestamps remain so
a delayed original save or old edit cannot recreate the content. Forgotten rows
are excluded from active lists/capacity, and their markers are not automatically
purged. No old-text history, content hash, or command ledger is retained. Visible
transcripts, backups, and provider retention are separate from active forgetting.
A new explicit save with a fresh key can deliberately remember that wording again.

## Transaction flow

1. The API guard authenticates the owner. Mutations require JSON, exact Origin,
   and session-bound CSRF; responses are private/no-store.
2. [PersonalMemory](../packages/backend/src/memory/application/personal-memory.ts)
   validates commands and owns replay/conflict, revision, busy, and capacity rules.
3. [API composition](../apps/api/src/memory/infrastructure/create-personal-memory.ts)
   opens a transaction and takes identity's `lockOwnerForUpdate`, shared with
   conversation admission. It supplies transaction-bound memory persistence and
   the public conversation capability.
4. Exact accepted replay is resolved before new-write busy/capacity checks. A new
   mutation is rejected while an unexpired conversation attempt runs. Expired
   attempts do not block it; persisted deadlines prevent late completion.
5. The memory repository updates only `memories`; the conversation capability
   updates its own context boundary. Both commit together or both roll back.
   Reads remain available during generation.

Repositories never query another module's tables. Application ports expose
capabilities rather than Drizzle objects. No independent transaction is opened
for the conversation check. Core code stays independent of NestJS and Drizzle;
public backend entries are `memory`, `memory/persistence`, and `memory/schema`.

## API and recovery

All endpoints are under `/api/v1`, require a session, and use generated
[OpenAPI/client contracts](../packages/api-client/openapi.json).

| Method | Path                           | Input / result                                                   |
| ------ | ------------------------------ | ---------------------------------------------------------------- |
| POST   | `/memory`                      | `{ requestId, sourceRequest }` → committed active entry          |
| GET    | `/memory`                      | `{ entries, limits }` with active entries                        |
| GET    | `/memory/{entryId}`            | Active entry or text-free forgotten metadata                     |
| GET    | `/memory/requests/{requestId}` | Lookup by original save key; active or forgotten state           |
| PATCH  | `/memory/{entryId}`            | `{ requestId, expectedRevision, sourceRequest }` → updated entry |
| DELETE | `/memory/{entryId}`            | `{ requestId, expectedRevision }` → forgotten metadata           |

Owner identity comes from the session. Invalid input returns 400; absent or
other-owner resources return 404; revision/key conflicts, busy state, and capacity
errors return 409; forgotten-operation errors use 410. Reads may instead return
the text-free forgotten representation.

An exact original-save replay returns an unchanged entry, reports `ENTRY_CHANGED`
after editing, or `FORGOTTEN` after forgetting. It never restores old wording.
Edits check the expected revision and recognize their latest exact mutation key;
older acknowledgements can become stale after another change. An already-forgotten
entry confirms the desired state without another mutation.

Lost responses retain the exact command. Save recovery reads by original request
ID; edit/forget recovery reads the selected entry. The latest mutation ID,
revision, and source identify an accepted edit. A newer conflicting revision
requires review. A forgotten state resolves forgetting without another DELETE.
An absent/unchanged read does not prove an in-flight write failed.

The browser offers explicit check/retry actions and never automatically replays or
queues a mutation. Rejected changes preserve the editor draft. **Review latest**
loads the current entry and adopts its revision only after deliberate review,
keeping the draft; the owner then explicitly saves or forgets. A failed review
read can be retried. Reviewing never submits a write.

Save alone clears its submitted composer draft. Edit/forget never clear the
independent composer draft. Session replacement/unmount cancels delivery and
clears scoped state. Only the memory list is query-cached; selected-entry recovery
uses direct reads. Confirmed changes cancel stale list reads, update the cache,
and invalidate it for a fresh read.

## Active memory in conversation

API composition supplies the conversation-owned profile-read port using
`PersonalMemory.list`, mapping only active wording. New attempts read the complete
current profile after admission, ordered by creation time then ID. Replays return
the saved snapshot; intentional retry reads current memory.

The SDK receives a separate user-data message before eligible history:

```text
Saved personal memories (owner-provided data):
["I prefer learning through small exercises."]
```

Only wording travels in this profile. IDs, source requests, timestamps, revisions,
and forgotten entries stay out of it. An empty profile adds no message. Saved
content is never interpolated into governing instructions and cannot register
tools or grant permissions. Hosted web search remains the only production tool.

Context selection reserves the full serialized profile plus the current question
before fitting recent completed exchanges. The label, JSON escaping, and message
fields count toward the byte limit. If required context cannot fit, the admitted
attempt fails with `LIMIT_EXCEEDED` before a provider request; the profile is never
silently truncated. A profile-read failure also prevents provider work and saves
a redacted failure. Deadlines bound preparation as well as execution.

For example, correcting a learning preference atomically advances the
conversation-owned `context_start_sequence` to its next sequence. Earlier user and
assistant restatements remain visible but cannot enter subsequent history context.
New exchanges accumulate normally. Forgetting advances the boundary again. Clear
history resets sequence/boundary for its new version while retaining active
memory. Deliberately supplying the same wording in a new message remains possible.

## Code reading order

1. [Command parser](../packages/memory-command/src/index.ts) and
   [memory domain](../packages/backend/src/memory/domain/memory.ts): literal wording
   and capacity rules.
2. [PersonalMemory](../packages/backend/src/memory/application/personal-memory.ts)
   and its transaction port: replay, revisions, busy checks, and atomic context reset.
3. [Memory repository](../packages/backend/src/memory/adapters/drizzle-memory.repository.ts)
   and [API composition](../apps/api/src/memory/infrastructure/create-personal-memory.ts):
   module-owned persistence and shared owner-lock transaction.
4. [HTTP controller](../apps/api/src/memory/adapters/driving/http/memory.controller.ts):
   protected routes and presentation.
5. `apps/web/src/features/memory/state/`: save/change operations, shared bounded
   execution/lifetime guards, session-scoped list cache, and explicit recovery.
   `ui/memory-panel.tsx` owns inspection/editor presentation.
6. [Profile port](../packages/backend/src/conversation/application/ports/conversation-profile.reader.ts),
   [context selector](../packages/backend/src/conversation/application/select-context.ts),
   and [SDK adapter](../packages/backend/src/conversation/adapters/openai-conversation.model.ts):
   active wording in model input. See [the conversation guide](conversation-loop.md).

## Verification

Run `pnpm check` and `pnpm test:integration`. Integration uses disposable
PostgreSQL/pgvector with actual migrations, real auth/CSRF, owner-scoped HTTP
operations, and restart recovery. It checks literal wording, replay/conflicts,
capacity, rollback, competing admission/memory transactions, stale edits,
forgetting, context exclusion, and current-profile retry. Model adapter/composition
checks use the real SDK/client with localhost responses and deny other provider
traffic. Capture makes no provider call.

Local integrated memory acceptance covers 26 phone/desktop scenarios through real
cookies, the production Next.js rewrite, NestJS, disposable PostgreSQL, and a
localhost provider stub. It includes save/reload, model-disabled management,
edit/conflict review, lost mutation responses, forgetting, current wording in
captured model input, exclusion of old user/assistant restatements, stale replay,
clear-history independence, and auth cleanup. Harness/results are local artifacts
under ignored `output/playwright/integrated/memory/`, not a committed browser suite.

Fixture answers verify roles, context, persistence, and UI behavior; they do not
establish live model obedience, answer quality, hosted-search compatibility, or
universal prompt-injection protection. Deployed TLS/proxy behavior remains
unverified. Automatic extraction, semantic retrieval, background consolidation,
exports, reminders, proactivity, and external actions are not implemented.
