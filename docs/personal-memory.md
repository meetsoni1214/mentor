# Explicit personal memory

Checkpoint 1 implements authenticated API save/read with one `memories` table.
The owner requested this simpler design after reviewing the initial four-table
version. The composer, Memory panel, correction/forgetting, and model use remain
later [checkpoints](../openspec/changes/add-explicit-personal-memory/tasks.md).

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

Checkpoint 2 adds composer capture and the Memory panel. Checkpoint 3 first reviews
edit/forget recovery, then adds those operations and conversation context
boundaries. A hard delete would lose the save request ID; correction would change
the text currently used to compare replays. The save-only mechanism does not
claim to solve either problem yet. Historical revision browsing and separate
command receipts are not prebuilt requirements.

Profile injection stays disabled until those behaviors are verified. Browser
memory integration and deployed TLS/proxy behavior are also unverified here.
Commit/archive and advancing to the next checkpoint require a separate request.
