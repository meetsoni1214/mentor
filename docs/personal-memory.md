# Explicit personal memory

Checkpoints 1–2 implement authenticated API save/read with one `memories` table,
composer capture, and a focused Memory panel. The owner requested the simpler
storage design after reviewing the initial four-table version. Correction,
forgetting, and model use remain later
[checkpoints](../openspec/changes/add-explicit-personal-memory/tasks.md).

## Storage

[`0009_explicit_personal_memory.sql`](../packages/backend/drizzle/0009_explicit_personal_memory.sql)
creates six columns:

| Column           | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `id`             | Memory UUID                                  |
| `owner_id`       | Authenticated owner, enforced by foreign key |
| `request_id`     | Original save UUID; unique per owner         |
| `text`           | Saved wording                                |
| `source_request` | Exact original direct request                |
| `created_at`     | Database creation timestamp                  |

There are no revision-history, profile-state, or command-receipt tables. There
is no entry revision, profile version, or update timestamp yet. These operations
currently save new memories and read them; nothing edits or deletes a memory.

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

Keep the IDs to repeat reads after reload/restart. This checkpoint has no edit or
forget route, so a manual save persists until those later operations exist.

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

Checkpoint 3 first reviews
edit/forget recovery, then adds those operations and conversation context
boundaries. A hard delete would lose the save request ID; correction would change
the text currently used to compare replays. The save-only mechanism does not
claim to solve either problem yet. Historical revision browsing and separate
command receipts are not prebuilt requirements.

Profile injection stays disabled until those behaviors are verified. Real-authenticated integrated browser memory acceptance belongs to checkpoint 5;
deployed TLS/proxy behavior is also unverified.
Commit/archive and advancing to the next checkpoint require a separate request.

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
forgetting are still unavailable.

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
