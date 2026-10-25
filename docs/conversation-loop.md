# The conversation loop: first review checkpoint

Mentor will have one continuous conversation. The owner will not create, name,
or choose threads. This checkpoint implements its backend persistence and run
lifecycle. The current web screen and API routes are unchanged. A later backend
checkpoint adds AI configuration and an execution gate, described below. No
OpenAI SDK, paid calls, email connection, or background jobs are involved yet.

## Start the review here

Read these files in order:

1. `packages/backend/src/conversation/domain/conversation.ts` defines the
   domain types, errors, completion rule, and latest-turn-only retry rule.
2. `packages/backend/src/conversation/domain/admission-policy.ts` owns
   history-version checks, submission replay/conflict decisions, retry-key
   replay, and the rule against starting another concurrent attempt.
3. `packages/backend/src/conversation/application/conversation.contracts.ts`
   defines use-case inputs, execution settings, and history/result shapes.
4. `packages/backend/src/conversation/application/ports/` defines the repository
   and model interfaces the application depends on.
5. `packages/backend/src/conversation/application/select-context.ts` selects
   bounded model messages without persistence, clocks, or provider dependencies.
   `application/conversation-loop.ts` coordinates admission, context loading,
   selection, provider invocation, timeout, and completion.
6. `packages/backend/src/conversation/adapters/drizzle-conversation.repository.ts`
   loads stored facts, evaluates domain policies under the owner lock, and
   implements atomic persistence through the repository port.
   `adapters/conversation.mapper.ts` explicitly maps stored rows to application
   turns/attempts and validates each attempt's state-dependent fields.
7. `tests/integration/conversation.test.ts` exercises those rules with real
   PostgreSQL and a synthetic provider. Unit tests use a fake clock to check
   deadlines, omitted context, and provider failures.

Domain code has no application or adapter imports. Application code depends on
the domain and its ports, with no NestJS, HTTP, Drizzle, or provider SDK imports.
The repository and model are interfaces: persistence and model execution can
change independently of the conversation rules. There is one use-case class,
not an agent framework or a generic workflow engine.

## AI configuration and disabled execution

Task 2.1 adds `config/ai.environment.ts`, available to server composition through
`@mentor/backend/config/ai`. It accepts an injected environment for deterministic
tests and defaults to the server's environment. It does not read or write `.env`
files, make network calls, or initialize a provider.

Execution becomes ready automatically with a nonempty `OPENAI_API_KEY`, an
explicit `OPENAI_CHAT_MODEL`, and valid limits. There is no separate enable flag
or default model. Missing or invalid settings return `{ enabled: false, invalidKeys }`,
with only the affected configuration key names. Values and raw Zod errors are excluded.
This keeps a configuration problem from preventing access to stored history.

Enabled configuration contains the server key separately from plain `RunLimits`.
Only the provider adapter will receive that key. Core use cases and model request
messages do not need credentials, environment APIs, or configuration readers.
Never serialize enabled configuration into HTTP responses or logs. Existing lint
boundaries reject browser/API-client imports of this server-only entry point.

| Environment key        | Default | Accepted integer range |
| ---------------------- | ------- | ---------------------- |
| `AI_MAX_MESSAGE_BYTES` | 8,192   | 1–65,536               |
| `AI_MAX_CONTEXT_BYTES` | 32,768  | 128–262,144            |
| `AI_MAX_OUTPUT_TOKENS` | 2,048   | 1–32,768               |
| `AI_DEADLINE_MS`       | 60,000  | 100–300,000            |
| `AI_MAX_TOOL_CALLS`    | 2       | 1–10                   |

The context budget must also be at least the raw message limit. These are finite
application guardrails, not guarantees of model compatibility or an exact billing
cap. The selector checks serialized message bytes; the later provider adapter
must additionally account for instructions and request overhead. The database
still permits only one running attempt per owner; no daily attempt cap is added.
`allowedTools` is empty in this environment reader. Runtime-controlled public-web
permission and observed activity remain in their later checkpoint.

`ConversationLoop` now receives either `{ enabled: false }` or
`{ enabled: true, model, limits }`. The disabled branch needs neither model nor
limits. Submit and retry reject with `EXECUTION_UNAVAILABLE` before repository
admission, so no user turn or run is added. History reads and versioned clearing
remain available. Enabled execution retains the existing input checks, replay,
deadline, cancellation, and conditional completion behavior.

This checkpoint verifies those branches directly with the real repository and
synthetic configuration. It does not yet wire an OpenAI adapter into Nest, add
assistant HTTP/status routes, or preserve drafts in a conversation UI. Those
remain tasks 2.2–2.4 and group 3. Setting environment values alone does not enable
an interactive conversation in the current app. `.env.example` documents defaults;
an existing `.env` is left untouched.

## Follow one message

Suppose the owner says, "Discuss this security notice."

```text
Submission: owner, request UUID, history version, text
    --> ConversationLoop.submit
    --> repository.submit: commit user turn + running attempt
    --> repository.context: recent completed turn pairs
    --> selectContext: chronological bounded messages + omission flag
    --> injected ConversationModel.complete, outside any transaction
    --> repository.finish: save outcome only if still current and in time
    --> return persisted attempt
```

The caller supplies the owner identity. Future authenticated HTTP adapters must
derive it from the session, never from browser JSON. There are no conversation
HTTP routes in this checkpoint. The tests call the use case directly.

The first submission automatically creates the singleton conversation. A history
read before then returns an empty transcript without inserting a row. PostgreSQL
enforces a unique owner foreign key. Returning later or changing topic continues
the same sequence of turns.

## A turn and an attempt are different

A turn contains the original user message. An attempt records one effort to
answer it, including its model, deadline, status, final answer or fixed error
code, nullable integer `inputTokens` and `outputTokens` counts, and normalized source/activity metadata. Unknown counts stay null; known zero counts stay zero. Database checks reject negative counts. The model port can return a grouped usage object, which the repository maps into these two columns.

`RunAttempt` is a discriminated union. Running attempts have no answer, finish
timestamp, or error. Completed attempts require an answer and finish timestamp
and have no error. Failed/interrupted attempts require a finish timestamp and
their appropriate error code, and have no answer. Checking `state` therefore
narrows these fields for callers without assertions or casts.

Persistence mappers enumerate the application fields instead of returning rows
directly. The stored `conversationId` and future internal columns do not escape
through admission, retry/replay, completion, or history results. The mapper
rejects inconsistent state/nullable fields and unknown error codes with a fixed
error that contains no stored content. Completed context pairs with a missing
answer also fail explicitly. These checks supplement database constraints;
they do not replace them or implement the later provider-response validation.

For example, a provider failure followed by an explicit retry produces:

```text
Turn 1: Discuss this security notice.
    Attempt 1: failed (PROVIDER_ERROR)
    Attempt 2: completed
```

The original message is stored once. Retry requires a fresh UUID and is permitted
only for the most recent turn when its latest attempt failed or was interrupted.
Retrying an older turn would insert an answer behind newer messages, so that
request is rejected. A retry of a completed turn is rejected too.

A matching request UUID returns existing state without another provider call. Reusing it for different text is a conflict, detected by comparing the stored text directly. No input fingerprint is needed. Retry keys cannot be reused as new-submission keys. Attempt numbers
give retries an unambiguous order even when timestamps fall in the same millisecond.

## Why admission uses a database lock

Admission briefly locks the owner row, then checks the history version, reconciles
expired attempts, checks duplicate keys, and rejects another active run. It then
commits the turn and attempt. The owner lock serializes these
steps across tabs and API processes. A partial unique index independently prevents
two running attempts in the same singleton conversation.

The adapter owns the SQL, lock, and transaction. Framework-independent domain
functions own replay, conflict, and busy decisions. Policy evaluation remains
inside the locked transaction: moving it before the lock would allow competing
requests to decide using outdated state. Unit tests exercise those decisions
without a database; integration tests establish that concurrent requests still
admit only one attempt. Replays remain readable while another attempt runs,
including retries accepted before a newer message, and preserve conflict errors
when submission and retry keys are mixed.

There is no transaction or connection held during model execution. A second
distinct submission while an attempt is running returns BUSY. A replay of that
attempt's original key can inspect its state without starting more work.

There is no daily attempt limit or daily usage counter in this slice. Per-run
input/output, tool-call, deadline, and concurrency limits remain. Limits are
injected values here; server environment configuration and live-provider
enablement belong to checkpoint 2.

## Expiry and interruption

The repository obtains time from PostgreSQL after acquiring the owner lock.
Deadlines are persisted. History reads and new admissions mark expired running
attempts interrupted. Completion checks state and deadline again, including a
database-clock condition on the update, so a late answer cannot become successful.

The use case also aborts the provider signal at the deadline and stops waiting
even if a fake provider ignores cancellation. Errors are normalized without
returning their private exception payloads. Provider work is never automatically
retried. Browser disconnect is not modeled as cancellation; future HTTP code must
preserve that behavior.

This is foreground execution. If the process dies after admission, a later read
will eventually expose an interrupted attempt. It does not automatically resume
paid work. Reliable unattended execution will need the later worker slice.

## Tool selection

User messages have no investigation flag. Server-controlled `allowedTools`
settings supply available tools to the model port; the assistant decides whether
an available tool is useful. In the later OpenAI adapter, permitted public-web
search will be optional rather than forced on every message. Runtime limits
still apply, and observed attempt activity records what actually happened.
Retries apply current tool permissions rather than restoring old permissions.
This checkpoint tests the port with a fake provider; actual web search remains
in the later model/tool adapter checkpoint.

Migration `0004_remove_turn_investigation.sql` removes the historical per-turn
column and recalculates request fingerprints from text alone, preserving
idempotent replay of previously accepted messages. Migration 0003 remains intact
for databases that already applied it. Migration `0005_remove_turn_input_digest.sql` then removes the redundant fingerprint column; replay validation compares stored message text directly. Tests verify an existing message still replays without another attempt after both migrations. Migration `0006_attempt_token_columns.sql` copies existing JSON usage into nullable integer token columns before dropping the JSON column. Migration `0007_remove_daily_admissions.sql` drops the unused daily counter table. Migration `0008_remove_disclosure_acknowledgements.sql` removes the deferred acknowledgement table. No development data is migrated by tests.

## Retained history and model context

History is paginated, newest page first with messages ordered chronologically
within each page. The cursor carries its history version. Older messages remain
available even when they do not fit in a model request.

For a new attempt, the use case selects the newest contiguous completed pairs
that fit its serialized UTF-8 byte limit, up to 100 pairs. It always retains the
current message. Failed and interrupted partial output is excluded. Omission sets
`contextLimited`; it never starts another conversation or deletes old messages.

`application/select-context.ts` owns that selection as a pure function. It accepts
the current text, completed pairs ordered newest first, and the byte budget. It
returns `{ messages, contextLimited }` without changing its inputs. Each pair is
included whole, and selection stops at the first pair that cannot fit; it does
not skip that pair to include smaller older ones. The selected messages are sent
in chronological order, ending with the current user message. `ModelMessage` in
the application contracts gives selection and the model port the same shape.

The repository still loads at most 101 completed pairs: 100 usable pairs plus
one to detect omission at the cap. The use case shares the selector's serialized
byte calculation when validating a new submission. For example, a message with
many quotes can fit its raw text limit but exceed the context limit once JSON
escaping and message fields are included; it is rejected before admission.

`ConversationLoop` retains deadline checks, abort handling, provider-error
normalization, and persistence. Selection's omission flag is combined with the
provider's own `contextLimited` flag before saving a completed response. Retry
selects context around the original accepted user text through the same path.
Admission and completion transactions are unchanged, and model calls still run
outside those transactions. The selector remains private to the module; no new
service, injected strategy, or package entry point is needed.

This checkpoint bounds the messages passed to the model port. Checkpoint 2 must
also account for provider instructions and other request overhead when applying
the final adapter input bound. Long-term memory, historical retrieval, and
automatic summarization are not implemented. Stored history alone is not a
promise that the model can recall every older fact.

## Clear history and stale tabs

The conversation row survives clearing; messages, attempts, and their embedded
source/activity records are removed. An atomic history-version increment makes
pre-clear submissions, retries, cursor reads, and repeated clear requests stale.

For example, tab A sees version 0, tab B clears history and advances to version 1.
Tab A's delayed version-0 submission cannot bring its old message back. A repeated
version-0 clear cannot erase new version-1 messages. A running attempt's late
completion also cannot restore cleared data. The use case aborts local provider
work when possible; persisted version checks protect against other processes.

No disclosure acknowledgement table or acknowledgement gate is included. A later
UI checkpoint will explain cloud processing through an informational notice.
Local clearing cannot retract content already sent to a provider.

## Verification

Run from the repository root:

```bash
pnpm test
pnpm test:integration
pnpm check
```

The integration runner creates a separate PostgreSQL/pgvector container with
temporary storage, applies all nine migrations, and removes that container
afterward. It does not use or migrate the development database. No `.env` changes
or database-volume removal are needed. The existing auth fixtures truncate their
disposable owner records with cascades so the new foreign keys are cleaned too.

Conversation integration cases cover singleton creation, constraints, duplicate
and competing submissions, persisted ordering, history pagination, expiry, retry
ordering and idempotency, sequential attempts without a daily cap, clear/completion/retry races,
stale-tab rejection, and the use case with a controllable fake provider. Existing
authentication integration checks continue to run. Unit cases cover exact deadline
boundaries, final-state protection, retry policy, bounded context, aborting an
unresponsive provider, invalid input, and sanitized failures.

There is no conversation browser acceptance or live-provider verification in this
checkpoint because the conversation HTTP adapter, UI, and OpenAI adapter are not
implemented. Later checkpoints add those checks before claiming the complete
conversation experience works.

Recorded on 2026-10-25: formatting, lint, strict type checking, and all 30 unit
tests pass. The isolated integration suite passes all 46 checks, including the
20 conversation checks. `pnpm check` reaches its production-build step but the
sandboxed Next.js process cannot parse TypeScript's configuration output.
`pnpm build` completes outside that sandbox. During that build, Next.js 16.4.0
also emits a dependency-security advisory; the first invocation stops for the
notice and the subsequent invocation completes with the warning. This checkpoint
does not upgrade dependencies or establish that the advisory has been resolved.

Architecture follow-up, also verified on 2026-10-25: admission decisions now live
in framework-independent domain functions and remain evaluated under the existing
database lock. `pnpm check` passes outside the sandbox with 49 unit tests.
`pnpm test:integration` passes all 48 checks, including 22 conversation checks.
The additional database cases verify competing fresh retry keys and replay of
older accepted submissions/retries while a newer attempt runs, including
submission/retry key conflicts. Strict OpenSpec validation passes. The existing
sandbox build limitation and Next.js dependency-security advisory remain.

Persistence-boundary follow-up, verified on 2026-10-25: the starting checkpoint
had 66 passing unit tests and 48 passing database/HTTP tests. Explicit row
mappers now cover every repository result, and `RunAttempt` has state-specific
answer/error/finish fields. `pnpm check` passes outside the sandbox with 93 unit
tests, including malformed-record rejection and compile-time field-narrowing
checks. `pnpm test:integration` passes all 50 checks, including 24 conversation
checks. The added database scenarios exercise mapped results across the run
lifecycle and safe rejection of a stored error code not enumerated by existing
SQL constraints. The temporary database is removed afterward. Generated API
contracts and versioned migrations have no changes; strict OpenSpec validation
passes. The existing sandbox build limitation and Next.js security advisory
remain. Conversation HTTP/UI/provider acceptance still belongs to later groups.

Context-selection follow-up, verified on 2026-10-25: the starting checkpoint
passed lint and 130 unit tests; its recorded integration baseline was 50 checks.
`selectContext` now owns the same selection algorithm as a pure application
function. `pnpm check` passes outside the sandbox with 144 unit tests, including
exact UTF-8/JSON byte boundaries, whole-pair selection, ordering, unchanged inputs,
the 100-pair cap, retry selection, and preservation of provider omission flags.
`pnpm test:integration` passes all 51 checks, including 25 conversation checks.
The new real-database scenario verifies bounded model messages, exclusion of
failed turns, full retained history, and the persisted omission flag. Existing
deadline, abort, replay, clear-history, and transaction checks still pass. The
temporary database and network were removed afterward. Generated API contracts,
versioned migrations, and OpenSpec tasks are unchanged; strict OpenSpec validation
passes. The existing Next.js security advisory still stops the initial build;
the repeated full gate passes with the warning. An upgrade remains recommended.
No conversation browser or live-provider acceptance is claimed by this slice.

Initial AI-configuration checkpoint (task 2.1), verified on 2026-10-25 before removal of the enable flag: the incoming
checkpoint passed lint and 144 unit tests, with 51 recorded integration checks.
`pnpm check` passes outside the sandbox with 170 unit tests. Added coverage checks
explicit enablement, missing credentials/model, invalid and inclusive numeric
bounds, incompatible limits, redacted diagnostics, browser import rejection, and
the enabled/disabled use-case branches. `pnpm test:integration` passes all 54
checks, including 28 conversation checks. The three additional real-database
scenarios cover explicit disablement, missing provider settings, and invalid
limits: no turn/attempt is admitted, saved history remains readable and unchanged,
and versioned clearing remains usable. The disposable test container and network
were removed. No existing `.env`, migration, generated API contract, or dependency
lockfile was changed, and no OpenAI calls were made. Strict OpenSpec validation
passes. Task 2.1 is complete; 2.2–2.5 remain open. Existing Next.js 16.4.0 security
advisory behavior persists: the first full-gate build stops, and its retry passes
with the warning. An upgrade remains recommended. Provider, HTTP, and browser
acceptance remain in later checkpoints.

Configuration revision on 2026-10-25: the separate enable switch was removed at
the owner's request. Valid model/key/limit settings now yield `enabled: true`
automatically; missing or invalid settings still preserve history access.
The seven obsolete toggle-specific cases were removed. Lint, strict service/test
types, all 163 unit tests, and all 54 disposable-database tests pass. Strict
OpenSpec validation passes. The production build was not rerun for this focused
configuration revision; its earlier evidence and advisory remain recorded above.
