# Explicit personal memory

Checkpoints 1–4 implement authenticated API save/read with one `memories` table,
composer capture, and a focused Memory panel. The owner requested the simpler
storage design after reviewing the initial four-table version. Correction and
forgetting are implemented in checkpoint 3. Checkpoint 4 supplies the active
profile to conversation attempts as labeled personal data. Integrated browser
acceptance remains [checkpoint 5](../openspec/changes/add-explicit-personal-memory/tasks.md).

## Storage

[`0009_explicit_personal_memory.sql`](../packages/backend/drizzle/0009_explicit_personal_memory.sql)
creates six columns:

| Column           | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `id`             | Memory UUID                                  |
| `owner_id`       | Authenticated owner, enforced by foreign key |
| `request_id`     | Original save UUID; unique per owner         |
| `text`           | Saved wording                                |
| `source_request` | Direct request for current wording           |
| `created_at`     | Database creation timestamp                  |

There are no revision-history, profile-state, or command-receipt tables.
Checkpoint 3 adds entry revision, latest mutation request ID, and forgetting
metadata; see the mutation guide below. There is no profile-wide version or
revision-history browser.

Bounds remain 20 entries, 512 UTF-8 bytes per wording, 4096 bytes of total wording,
and 1024 bytes per original request. PostgreSQL checks per-row bounds;
`PersonalMemory` checks aggregate capacity under the owner row lock. The list exposes
these limits. Independent requests can both save within capacity without a
profile-version conflict. Repeated wording under a fresh request ID creates a
separate memory; there is no semantic deduplication.

## Request flow

1. The existing guard authenticates the owner. POST requires the configured
   Origin and session-bound CSRF token. The controller requires JSON; all
   responses are private/no-store.
2. [`PersonalMemory`](../packages/backend/src/memory/application/personal-memory.ts)
   validates UUIDs and the strict `{ requestId, sourceRequest }` body. Owner ID
   comes from the session. Unknown fields, including the previous
   `expectedProfileVersion`, are rejected.
3. The domain accepts a case-insensitive, start-of-input `Remember that ` followed
   by nonblank wording. It trims only payload boundary whitespace, preserving
   spelling and internal spaces/newlines. The original request is kept intact.
   NUL and unpaired surrogates are rejected because PostgreSQL cannot retain
   them faithfully. Quoted requests, articles, and ordinary chat are not scanned.
4. [`createPersonalMemory`](../apps/api/src/memory/infrastructure/create-personal-memory.ts)
   implements the memory-owned `MemoryTransactions` port. It starts a database
   transaction and acquires identity persistence's `lockOwnerForUpdate`, the same
   function used by conversation admission. It supplies a memory repository and
   the public `ConversationActivity` service, both bound to that transaction.
5. Inside that scope, `PersonalMemory` resolves a saved request before checking
   busy state or capacity. Exact replay returns the existing memory; changed
   input returns `IDEMPOTENCY_CONFLICT`. For a new request it asks the conversation
   service whether an unexpired attempt is running, rejects `BUSY` if needed,
   checks profile capacity, and calls the memory repository's insert operation.
   The scope returns success only after commit; an error rolls back. Expired
   attempts do not block saving, and existing deadline checks prevent late
   completion. No provider call or conversation turn is created.

The core stays independent of NestJS and Drizzle. HTTP decoding/presentation and
persistence remain adapters, with architecture lint and public backend entries
`memory`, `memory/persistence`, and `memory/schema`.

The persistence responsibilities are explicit:

| Component                             | Responsibility                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `PersonalMemory`                      | Replay/conflict, busy, capacity, and not-found application policy               |
| `DrizzleMemoryRepository`             | Queries/inserts only `memories`; missing reads return null                      |
| `ConversationActivity` and its reader | Public conversation query backed by conversation-owned tables and database time |
| `lockOwnerForUpdate`                  | Identity-owned owner lookup/row lock inside the caller's transaction            |
| `createPersonalMemory`                | Compose the module services within one transaction                              |

Drizzle transaction types stay at adapter/composition boundaries. The application
port exposes capabilities rather than ORM objects. Other module schemas are not
imported by the memory repository; lint rejects foreign-schema imports from
repositories. Each module performs its own queries. No independent transaction
or connection is opened for the conversation check, so the owner lock remains
held through the memory insert and commit. Reads use the same scoped owner
authorization but do not perform the conversation busy check.

## API and recovery

All endpoints below are under `/api/v1`, require a valid session, and work with
model execution disabled. Types come from the generated
[OpenAPI contract](../packages/api-client/openapi.json).

| Method and path                    | Response                                      |
| ---------------------------------- | --------------------------------------------- |
| `POST /memory`                     | Saved memory directly, with HTTP 200          |
| `GET /memory`                      | `{ entries, limits }`                         |
| `GET /memory/{entryId}`            | The saved memory                              |
| `GET /memory/requests/{requestId}` | The saved memory found by original request ID |

Example request:

```json
{
  "requestId": "0477b35f-44f2-4b52-9a40-14b8f05f2e51",
  "sourceRequest": "Remember that I prefer learning through small exercises."
}
```

The result contains `id`, `requestId`, `text`, `sourceRequest`, and `createdAt`.
The saved text is `I prefer learning through small exercises.`. List, detail,
request lookup, and exact POST replay return the same memory representation;
there is no receipt wrapper. Internal owner IDs are never returned.

If the response is lost, retain the exact request ID/payload and look up
`/memory/requests/{requestId}`. Explicitly resending that same request resolves to
the existing row. An absent result does not prove a pending save cannot still
commit; never automatically replay a mutation.

Invalid inputs return 400; absent or other-owner resources return 404; conflicting
request reuse, busy attempts, and profile capacity return 409. Existing session,
CSRF, body-size, media-type, and sanitized server-error behavior remain. Reads
are available while conversation execution runs. Clear history preserves memory
and its source because there is no conversation-turn dependency.

## Try it

`pnpm test:integration` applies the real migration to disposable PostgreSQL and
runs the [memory HTTP checks](../tests/integration/personal-memory-http.test.ts).
They save synthetic wording, restart the API, refresh CSRF for the persisted
session, and resolve the saved request without duplication. A failing model test
double verifies that memory never invokes a provider.

For a manual example after deliberately applying the migration and signing into
a running local app, use the same-origin browser developer console. The browser
supplies cookies and Origin; the snippet embeds no credentials:

```js
const readJson = async (response) => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const csrf = await fetch('/api/v1/auth/csrf').then(readJson);
const command = {
  requestId: crypto.randomUUID(),
  sourceRequest: 'Remember that I prefer learning through small exercises.',
};
const saved = await fetch('/api/v1/memory', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf.token,
  },
  body: JSON.stringify(command),
}).then(readJson);
const reopened = await fetch(`/api/v1/memory/${saved.id}`).then(readJson);
const recovered = await fetch(
  `/api/v1/memory/requests/${command.requestId}`,
).then(readJson);
console.log({ saved, reopened, recovered });
```

Keep the IDs to repeat reads after reload/restart. Edit and Forget are now
available through the Memory panel and protected API.

## Migration and verification

The versioned migration and its Drizzle snapshot/journal define one table. Checks use disposable infrastructure only; this work
does not migrate or reset the persistent development database. If the prior draft
was independently applied to persistent infrastructure, give it a deliberate
forward migration rather than reusing the changed migration. Existing applied
migrations 0000–0008 are unchanged.

Verification for checkpoint 1 including the module-boundary refactor (2026-11-09):

- `pnpm check` passes formatting, lint, types, all 510 unit/contract tests, and
  the default Turbopack production build.
- `pnpm test:integration` passes all 144 disposable PostgreSQL/HTTP/SDK checks,
  including 32 memory checks. Its database container and network were removed.
- Strict OpenSpec and whitespace checks pass. The migration snapshot adds only
  `memories`; the refactor leaves the migration and generated API contract intact.

The checks cover actual cookies/CSRF, restart recovery,
exact wording/provenance, request replay/conflicts, independent concurrent saves,
capacity, rollback, owner scope, running attempts/deadlines, and history clearing.
No live provider calls or development-data operations are part of verification.

The module-boundary refactor also checks admission races in both directions.
When admission holds the lock first, a new memory save is rejected as busy.
When memory holds it first, a test-only database trigger pauses the insert after
the activity read; PostgreSQL lock inspection confirms admission on another
connection waits until memory commits. Both race directions pass. Unit tests
exercise the application policies through fake ports, and architecture checks
reject foreign-schema repository imports and ORM types in the transaction port.

## Later checkpoints

Checkpoint 3 implements correction, forgetting, and context boundaries under the
[reviewed mutation design](personal-memory-mutations.md). Checkpoint 4 supplies
active memories to model input as described below; checkpoint 5 performs integrated
local browser acceptance. Commit/archive and advancing to the next checkpoint
require a separate request.

## Checkpoint 2: Composer capture and inspection

Type `Remember that I prefer learning through small exercises.` in the composer.
The preview shows `I prefer learning through small exercises.` and the action
changes to **Save memory** before submission. The prefix is case insensitive,
starts at the very beginning of the input, and requires one literal space after
`that`. Only payload boundary whitespace is trimmed; internal whitespace and the
original request are retained. Quoted commands and ordinary chat keep the normal
conversation action. Blank, unrepresentable, or oversized commands cannot save.

Click **Save memory**, then open **Memory** in the header to review the saved
wording. Reload and reopen the panel to read the server's saved entries. The
panel shows only saved wording, with a short capture hint when empty and
loading/error states as needed. Escape closes it and returns focus to the Memory
button. Clear history's confirmation explains that saved memories remain.
Original requests, IDs, timestamps, and limits remain available through the
protected API; they are not displayed in the panel.

Saving and reading do not depend on assistant readiness or successful conversation
history loading. Reading remains available during generation; known running work
blocks the save action and the backend remains authoritative across tabs. A
rejected save preserves the draft. No fake conversation turn or model answer is
created, and saved wording is **not supplied to the model yet**. Editing and
forgetting are implemented in checkpoint 3 below.

### Browser request and state flow

1. [`memory-contracts.ts`](../apps/web/src/features/memory/api/memory-contracts.ts)
   uses generated API types and validates response field shapes at runtime.
   It does not reapply profile capacity or require current wording to match the
   original request. Those are backend policies, and a corrected entry can have
   different wording. Server-reported limits are positive integers, not literal
   constants fixed in the browser.
   [`@mentor/memory-command`](../packages/memory-command/src/index.ts) supplies
   the public literal command parser, byte measurement, and default bounds to
   both the browser preview and backend save policy. It imports no framework,
   backend, or HTTP code.
2. [`memory-api.ts`](../apps/web/src/features/memory/api/memory-api.ts) calls the
   generated client through the same-origin API, obtains the existing CSRF token,
   and uses no-store reads/writes. Save, detail, and request lookup verify returned
   identity. Malformed success bodies remain unconfirmed rather than acknowledging
   a save. Authentication failures retain their status even with invalid bodies.
3. [`memory-queries.ts`](../apps/web/src/features/memory/state/memory-queries.ts)
   uses the public `SessionScope`. List/detail caches include the session generation;
   reads, saved-request checks, and saves ignore late results after replacement.
   SessionState clears the private query cache on logout/expiry. No memory or
   pending command is placed in browser storage.
4. [`useMemory`](../apps/web/src/features/memory/state/use-memory.ts) uses one
   TanStack Query mutation, configured in
   [`memory-save.ts`](../apps/web/src/features/memory/state/memory-save.ts).
   Query owns pending/success/error state; there is no custom save store,
   subscription list, or operation counter. The mutation variables retain one
   exact save command with a fresh request ID. The existing conversation coordinator
   still owns the composer draft. A captured draft revision clears only the
   submitted draft on confirmed success; any intervening edit is preserved, even
   if the owner types the same text again.
5. A network failure, invalid response, server failure, or 15-second confirmation
   timeout leaves that command uncertain. The timeout detaches local delivery;
   it does not establish that the server cancelled or failed. **Check saved request**
   performs a read. **Retry original save** deliberately sends the exact same ID
   and source request. Neither operation runs automatically. Mutation retries and offline queuing
   are explicitly disabled, even if global Query defaults enable them. A missing lookup or
   rejected replay does not disprove the first pending write. Duplicate actions
   are blocked while an operation is in flight. Conversation sends/retries wait
   until the original memory save is resolved, while next-draft editing remains
   available. Session replacement aborts scoped requests and clears the private query and
   mutation caches. Unmount aborts its lifetime signal; unobserved settled
   mutations have zero retention. A small synchronous hook guard blocks duplicate
   actions before React rerenders.
6. Confirmed saves invalidate memory reads. The
   [`MemoryPanel`](../apps/web/src/features/memory/ui/memory-panel.tsx) displays
   saved wording without technical metadata or invented conversation links.
   Memory remains independent of history versions and history deletion.

### Checkpoint 2 evidence (2026-11-09)

- `pnpm check`: formatting, lint, types, 549 unit/contract tests, and the default
  Turbopack production build pass. The 39 new browser API/coordinator checks cover
  literal commands, malformed responses, request identity, limits, CSRF/Origin,
  session replacement/expiry, late reads, duplicate clicks, lost responses,
  missing lookups, exact explicit retries, conflicting IDs, deadline recovery,
  and independent draft revisions.
- Twenty-eight synthetic scenarios pass at 1440×1000 and 390×844: save/inspect/
  reload, AI disabled, busy rejection, lost response with lookup, exact retry,
  absent lookup, independently edited next draft, invalid payloads, ordinary chat,
  panel read failure, session expiry, history read failure, and empty/loading
  panel states. Modal focus,
  Escape/return focus, Clear history disclosure, and horizontal overflow are
  checked. No memory flow calls conversation submission. Scripts, results, and
  screenshots are under `output/playwright/personal-memory/`.
- These browser scenarios intercept API responses. They verify presentation and
  client recovery, not real-cookie/database durability or actual model behavior;
  checkpoint 1's server evidence remains separate. No backend behavior, schema,
  migration, generated API, or dependency changes require repeating database
  integration for this browser-only checkpoint.
- Strict OpenSpec and whitespace checks pass. No live provider calls,
  development-data operations, existing `.env` edits, commit, or archive occurred.

Stop here for checkpoint 2 review. Checkpoint 3 starts with reviewing the concrete
correction/forgetting recovery design before enabling either operation.

## Checkpoint 2 simplification

The owner requested simplifying save coordination and removing repeated backend
contracts. The shared `@mentor/memory-command` package now defines literal capture
syntax and its default byte bounds once. Backend `explicitMemoryWording` delegates
to it while retaining authoritative replay, busy, capacity, and persistence policy.
Architecture checks permit this dependency only for the memory core and prevent
the shared package from importing server implementations.

Browser request/response types now reference the generated API types. Runtime Zod
validation remains for UUIDs, dates, strings, arrays, and positive numeric limits;
it does not reject changed server limits, recalculate profile capacity, or compare
current wording with original provenance. Request identity is still checked when
confirming a save. The API retains reported limits; the simplified Memory panel omits technical
limits and counters. OpenAPI/client generation changes only the four memory limit fields
from literal enums to positive numbers; endpoint payloads and actual limits do not
change. There is no schema migration.

Save coordination uses `useMutation`, with automatic retries disabled and
`networkMode: 'always'` so an offline attempt fails visibly rather than queuing a
write for reconnection. State/notice projection is a pure function of the mutation
result. The hook keeps only its unmount cancellation and a synchronous click guard;
the existing conversation coordinator still owns the draft. Session checks,
15-second confirmation bounds, exact-command explicit recovery, and independent
next-draft preservation remain covered by tests.

Verification of the simplification (2026-11-09):

- `pnpm check` passes formatting, lint, types, all 558 unit/contract tests, and
  the default Turbopack production build. Mutation tests exercise the same Query
  options used by the hook, including global retry defaults, offline execution,
  deadline recovery, lifecycle cancellation, and late responses.
- All 34 synthetic phone/desktop scenarios pass. The original 28 scenarios are
  extended with duplicate clicks, conflicting explicit replay, and changed
  server-reported limits at both viewport sizes. Results and the script are under
  `output/playwright/personal-memory/refactor-*`.
- `pnpm test:integration` passes all 144 disposable PostgreSQL/HTTP/SDK checks,
  confirming backend save policy, persistence, and ownership still work through
  the shared parser. The disposable database container and network were removed.
- Strict OpenSpec and whitespace checks pass. The lockfile adds only workspace
  links for the shared package; no external dependency versions, database
  migrations, existing `.env`, or development data changed. No live provider
  call, commit, or archive was made. Checkpoint 3 remains deferred.

## Memory panel presentation refinement

At the owner's request, the panel now focuses on saved wording. IDs, timestamps,
original-request details, byte limits, capacity counters, and implementation plans
are removed from the product view. The normal refresh action is also removed;
reopening the panel refreshes stale data, and a read error offers **Try again**.
The empty state explains the capture syntax. Save confirmation is simply
**Memory saved.** Recovery retains the original wording and explicit check/retry
actions without displaying request IDs. API data and save/recovery behavior are
unchanged.

Verification: memory ESLint and web type checking pass; all 47 memory API/save
tests and eight synthetic phone/desktop panel scenarios pass (loaded, empty,
loading, error, focus return, and no horizontal overflow). Artifacts are under
`output/playwright/personal-memory/panel-*` and `simple-panel-*`. This UI-only
refinement does not repeat backend integration or live-provider verification.

## Checkpoint 3: correction and forgetting

In Memory, select the saved wording to edit it, then choose **Save**. The small
pencil marks each editable row. **Forget** is available inside the editor and
removes the selected entry through one confirmation. An × in the header closes
the panel; Escape also closes it and returns focus to the Memory button. The action
explains that changing memory starts fresh model context; visible history stays.
New saves also reset context and disclose that effect in the composer hint.
Model personalization was still disabled at checkpoint 3; checkpoint 4 below
connects the active profile to conversation.

Use the same model-disabled application to manage memory. Rejected edits preserve
the edit draft. A stale-tab rejection shows current wording. Choose **Review
latest** to accept that entry version while keeping your draft, then explicitly
save or confirm forgetting. The panel never silently adopts a newer revision;
another concurrent change requires another review. Uncertain
changes retain their exact operation for **Check change** or **Retry change**,
without automatic replay or offline queuing. An unchanged or missing read does
not prove an in-flight write failed. The composer draft is independent.
Session replacement/unmount cancels delivery and clears scoped private state.

### Read the change

1. [Reviewed design decisions](personal-memory-mutations.md): why recovery keeps
   minimal metadata and why edits replace current-source provenance. This section
   is the canonical implementation walkthrough.
2. [PersonalMemory](../packages/backend/src/memory/application/personal-memory.ts):
   replay, revision/conflict, busy, capacity, and context-reset policy through
   transaction-scoped module capabilities.
3. [Memory repository](../packages/backend/src/memory/adapters/drizzle-memory.repository.ts)
   and [migration 0010](../packages/backend/drizzle/0010_memory_mutations.sql):
   nine-column memory table, null forgotten content, owner-scoped updates, and
   existing-conversation context-boundary backfill. Migration 0009 is unchanged.
4. [API controller](../apps/api/src/memory/adapters/driving/http/memory.controller.ts)
   and generated client: PATCH/DELETE `/memory/{entryId}` target an expected
   revision and fresh mutation ID. PATCH submits `sourceRequest`, replacing the
   previous wording and source rather than retaining its history. GET detail and
   saved-request lookup return active entries or text-free forgotten metadata.
5. [Browser change operation](../apps/web/src/features/memory/state/memory-change.ts)
   and [panel](../apps/web/src/features/memory/ui/memory-panel.tsx): response
   validation, exact explicit recovery, session/deadline cancellation, and minimal
   edit/forget controls. Obsolete save recovery resolves changed/forgotten
   outcomes without recreating text or clearing the next draft.

Save and change operations share [bounded request execution and failure
classification](../apps/web/src/features/memory/state/memory-recovery.ts) and
[component lifetime/duplicate-action handling](../apps/web/src/features/memory/state/use-memory-operation.ts).
Each operation retains its own result validation and recovery commands; save
alone clears its submitted composer draft. Only the list has a query cache;
recovery reads the selected entry directly. Confirmed changes cancel obsolete
list reads, update the displayed list, and invalidate it for a fresh read.

### Exact request and context trace

An edit submits `{ requestId, expectedRevision: 1, sourceRequest: "Remember that
I prefer explanations first." }` to a selected entry. Within the existing owner
lock, the use case checks replay, revision, busy state and capacity; the memory
repository replaces wording/source and increments the revision; the conversation
service sets its own `context_start_sequence` to `next_sequence`. One transaction
commits both operations. No module queries another module's tables directly.

After editing, `sourceRequest` describes the latest wording change. The browser
currently constructs that command from the editor text; it is not an untouched
copy of the original save request. Replacing it removes the older source text.

A lost response can be checked through GET detail: the latest mutation ID,
revision and exact source identify the accepted edit. A newer revision belonging
to another operation is a conflict. A forgotten state resolves a forget without
another DELETE; edit recovery sees FORGOTTEN. Earlier accepted edits become stale
after later changes. Original save IDs never recreate edited/forgotten content.

Forgetting nulls both `text` and `source_request`. Retained IDs, revision and
forgetting timestamps prevent old requests from resurrecting the entry. These
markers do not consume active capacity and are not automatically purged; there
is no old-text history, hash, or command ledger. Visible transcripts, database
backups and provider retention remain separate from active-memory forgetting.

Future context reads exclude sequences before the boundary, including assistant
restatements. Later exchanges accumulate normally. Clear history resets both
sequence fields while incrementing the history version. Known replays do not
advance the boundary. Reads remain available during generation, while new writes
are rejected as busy until the current attempt ends or its durable deadline
expires. The existing deadline check prevents an expired response from publishing.

### Run locally

Before trying checkpoint 3 against a local development database, deliberately run
`pnpm db:migrate`, then use the running app. This checkpoint creates migration
0010 but does not apply it to development data during verification.

### Checkpoint 3 evidence (2026-11-09)

- `pnpm check` passes formatting, lint, types, all 570 unit/contract tests, and
  the default Turbopack production build.
- `pnpm test:integration` passes all 155 disposable PostgreSQL/HTTP/SDK checks.
  New cases cover exact and older edit replay, stale deletion, forgotten content
  nulling, deliberate new saves, active-capacity reuse, competing edits,
  ownership/CSRF/Origin protections, running-attempt busy behavior and expired
  completion, atomic rollback, context exclusion/reset, and real upgrade SQL
  backfill. The disposable database container and network were removed.
- All 22 synthetic phone/desktop mutation scenarios pass at 1440×1000 and
  390×844: edit, forget, cancel, stale-tab response, busy response, lost edit
  response with read or exact retry, lost forget response with metadata lookup,
  missing/unchanged recovery reads, and session expiry. Independent composer
  drafts and horizontal layout remain intact. Scripts, results and screenshots
  are under `output/playwright/personal-memory/checkpoint3/`.
- Browser API responses are synthetic; this does not claim integrated real-auth
  memory acceptance, deployed proxy behavior, or live model obedience. API tests
  separately use real cookies/CSRF and the disposable migrated database. Model
  personalization and checkpoint 5's integrated memory demo remain deferred.
- Strict OpenSpec and whitespace checks pass. Generated contracts add mutation
  routes, entry revision/latest-operation metadata, forgotten outcomes and
  changed/forgotten errors. The lockfile and earlier migrations are unchanged.
  No live provider call, existing `.env` edit, development-data operation, commit,
  or archive occurred.

Checkpoint 3 is implemented and verified through the final checkpoint report
below. Checkpoint 4 requires a separate request.

### Memory controls simplification (2026-11-12)

The list now uses one clickable wording row with a pencil icon per memory.
Forget is inside the editor, with the existing single confirmation. A header
close icon replaces the large footer button. Mutation and recovery rules are
unchanged.

Web typing, focused ESLint, formatting, all 60 memory API/save/change tests, and
all 22 synthetic phone/desktop mutation scenarios pass. Browser checks also
cover keyboard activation, close/Escape focus return, independent composer
drafts, and layout at both sizes. The script and screenshots are under
`output/playwright/personal-memory/checkpoint3/simple-*`. This presentation-only
change does not repeat database integration or establish real-auth browser or
live-model acceptance.

### Browser recovery cleanup (2026-11-12)

The owner approved the review's unused-cache removal, shared recovery mechanics,
explicit conflict resolution, and focused documentation consolidation. The list
is the only query cache. Save and change flows share small request/lifetime/error
helpers while retaining their own result checks and draft policy. A conflict
requires **Review latest** before another explicit save or forget, preserving
the editor draft. A failed latest-entry read offers **Try again**. Reviewing
updates the selected version without submitting the form.

Verification:

- `pnpm check` passes formatting, lint, types, all 572 unit/contract tests, and
  the default Turbopack production build. The sandbox initially blocked localhost
  stub servers and subprocess checks; the full check passed with the required
  local process permissions.
- All 91 focused memory API/save/change/application tests pass, including an
  in-flight list response that must not restore obsolete wording after an edit.
- All 70 synthetic browser scenarios pass at 1440×1000 and 390×844: 34 save,
  22 mutation, and 14 conflict/review scenarios. New cases cover repeat conflicts,
  stale deletion, lost responses after reviewing, forgotten entries, failed
  latest reads, and duplicate submissions. Independent drafts, explicit retries,
  focus return, and layout remain covered. Scripts, result JSON, and screenshots
  are under `output/playwright/personal-memory/cleanup/`.
- Strict OpenSpec and whitespace checks pass. Generated OpenAPI/client output,
  migration SQL/metadata, and the lockfile match their pre-cleanup contents.
  No backend behavior changed, so disposable database integration was not
  repeated for this browser-only cleanup. Final checkpoint verification below
  separately reruns integration and completes task 3.5.
- Browser API responses are synthetic. This does not establish integrated
  real-auth memory acceptance or live model behavior. No live provider calls,
  development-data operations, commit, or archive were performed.

Removing Forget's request ID and changing the editor payload to plain wording
remain separate design decisions. Checkpoint 4 remains deferred.

### Final checkpoint 3 verification (2026-11-12)

The owner reviewed the implementation, approved the browser cleanup and typed
identifier arguments, and requested a commit. `PersonalMemory` accepts string
identifiers with runtime UUID validation and unknown request bodies with Zod
validation. Blank lines separate the use case's logical steps.

- `pnpm check` passes all 572 unit/contract tests, formatting, lint, types, and
  the default Turbopack production build on the final code.
- `pnpm test:integration` passes all 155 disposable PostgreSQL/HTTP/SDK checks.
  The test database uses real migrations; its container and network were removed.
- The 70 synthetic phone/desktop scenarios from the cleanup report remain the
  browser evidence. Later identifier-type and spacing edits do not change browser
  behavior; browser acceptance was not repeated for those edits.
- Strict OpenSpec and whitespace checks pass. Generated contracts accompany the
  protected mutation routes, and migration 0010 carries the schema changes.
- Task 3.5's final verification is complete. Checkpoint 4's model use and checkpoint
  5's integrated memory acceptance remain deferred. No live provider calls,
  development-data operations, or archive were performed.

## Checkpoint 4: active memory in conversation

New attempts now read the current owner's complete active profile and pass its
literal wording as labeled personal data. Capture still makes no model call or
fake conversation turn. An empty profile adds no message. Only wording travels
to the provider: IDs, source requests, timestamps, revisions, and forgotten
entries stay out of the profile input. List ordering remains creation time then
ID, so an unchanged profile has a stable representation across requests.

### Read the change

1. [Conversation profile port](../packages/backend/src/conversation/application/ports/conversation-profile.reader.ts)
   defines `read(ownerId)` and the readonly string profile. Conversation core
   imports neither memory implementation nor persistence.
2. [API composition](../apps/api/src/conversation/infrastructure/conversation.module.ts)
   supplies the port using `PersonalMemory.list`, mapping only active wording.
   The memory use case retains its owner-scoped transaction and owner lock.
3. [ConversationLoop](../packages/backend/src/conversation/application/conversation-loop.ts)
   reads eligible history and the profile after new admission. Replayed requests
   return their saved attempt without rereading either. Intentional retry uses
   current memory with the original accepted question.
4. [Context selection](../packages/backend/src/conversation/application/select-context.ts)
   reserves the complete profile plus current input before fitting whole recent
   exchanges. [Personal-context serialization](../packages/backend/src/conversation/application/personal-context.ts)
   is shared by accounting and the model adapter, including its label, JSON
   escaping, message fields, and UTF-8 representation.
5. [SDK adapter](../packages/backend/src/conversation/adapters/openai-conversation.model.ts)
   places that labeled data in a separate user message before the chronological
   transcript. Governing instructions describe its role; saved content is never
   interpolated into those instructions. Production still registers only hosted
   web search. Memories cannot register write tools or grant permissions.

### Exact request and data trace

Save `Remember that I prefer learning through small exercises.` using **Save
memory**. The committed row contains `I prefer learning through small exercises.`
and its source request; saving starts fresh model context without creating a
conversation turn or invoking the provider.

Submit `Teach me database indexes.` through the existing conversation endpoint.
Admission commits the running attempt under the owner lock. The use case reads
eligible completed exchanges and asks the composed profile port for active
wording. With no eligible history, its model input contains:

```json
{
  "personalContext": ["I prefer learning through small exercises."],
  "messages": [{ "role": "user", "text": "Teach me database indexes." }]
}
```

The SDK receives a first user message whose content is exactly:

```text
Saved personal memories (owner-provided data):
["I prefer learning through small exercises."]
```

The next user message contains the current question. Eligible earlier exchanges,
when present, appear between the profile and current question. Existing SDK
iterations, output settings, per-request hosted-search setting, deadlines,
storage/tracing controls, and no automatic provider retry remain unchanged.
There is no provider session or response-ID chain.

Correct the selected entry to `I prefer a complete explanation first.`. The
existing transaction replaces wording/source and advances the conversation's
context boundary. The next attempt receives only current wording and exchanges
at or after that boundary. Old user and assistant restatements remain readable
in history but cannot enter context through history selection. New exchanges
accumulate normally. Forgetting removes the entry from the profile and advances
the boundary again. This does not prevent a new user message from deliberately
supplying the same wording. Clear history preserves active memories and resets
the boundary with sequence numbering for the new history version.

The composer hint and memory editor already explain that a memory change starts
fresh model context while history stays. Those disclosures remain in place;
no extra confirmation or composer privacy footer is added.

### Limits and recovery

If the full serialized profile plus current question exceeds the configured
context bound, the admitted attempt is saved as `failed / LIMIT_EXCEEDED` without
a provider request. The existing UI displays “This response reached an execution
limit.” It remains inspectable and explicitly retryable. Review memory or the
server's context setting before retrying; repeated identical retries cannot fix
the same size constraint. The profile is never silently truncated. When only
older eligible exchanges are omitted, the completed attempt's `contextLimited`
flag retains the existing older-messages notice.

A profile-read failure also prevents a provider request and saves the existing
redacted `PROVIDER_ERROR` failure. The deadline bounds preparation as well as
model execution; a late profile read cannot start provider work after the
attempt is interrupted. Memory changes remain busy during an unexpired attempt;
durable database deadline checks prevent expired answers from publishing after
memory changes. No new schema, API contract, enable flag, or cumulative budget
is introduced.

### Checkpoint 4 verification (2026-11-12)

Focused unit and localhost SDK checks cover exact serialized profile limits,
Unicode/escaping, empty profiles, replay, redacted read failures, delayed reads,
streaming and JSON input roles, and unregistered memory-write calls. Composed
PostgreSQL/SDK scenarios in
[personal-memory-context.test.ts](../tests/integration/personal-memory-context.test.ts)
cover literal active-entry ordering, singleton-owner replacement, capture without
provider calls, correction/forgetting with prior restatements, Clear history,
101 earlier exchanges, profile-size rejection, intentional retry with current
memory, omitted history, and busy/expired attempts.

- `pnpm check` passes formatting, lint, strict typing, all 589 unit/contract
  tests, and the default Turbopack production build.
- `pnpm test:integration` passes all 163 disposable PostgreSQL/HTTP/SDK checks,
  including eight new composed profile scenarios. The harness removes its test
  container, volume, and network afterward.
- Strict OpenSpec validation and whitespace checks pass. Regenerated API/client
  contracts have no drift; this slice adds no migration or dependency change.
  Development-startup and lockfile edits already present in the workspace remain
  separate from this checkpoint.
- Generated `.playwright-cli/` snapshots are ignored alongside existing browser
  artifacts; the initial full check encountered formatting in three such files.
  Their contents were preserved, and the full check then passed. Local SDK tests
  and production build used the permitted execution route for localhost listening.
- No live provider calls, development-data operations, new browser acceptance,
  commit, or archive were performed. The walkthrough above is the review entry
  point; stop here before checkpoint 5.

These tests inspect real SDK requests to a localhost stub; all other provider
traffic is denied. Fixture answers are supplied by the stub and do not establish
live model obedience, teaching quality, or universal prompt-injection protection.
Checkpoint 5's integrated phone/desktop memory journey remains deferred.
