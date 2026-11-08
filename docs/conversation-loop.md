# The conversation loop: API and conversation workspace

Mentor will have one continuous conversation. The owner will not create, name,
or choose threads. This checkpoint implements its backend persistence and run
lifecycle, server-only AI configuration, and a standard Agents SDK adapter verified
against a local HTTP stub. Task 2.3 composes the use case, repository, and SDK
adapter in the API's ConversationModule. Tasks 2.4–2.5 expose and document protected
status and singleton conversation routes with generated OpenAPI/client types.
Application-owned Zod schemas validate commands; shared HTTP presenters map
responses and a dedicated streaming HTTP service owns SSE delivery.
The backend also exposes opt-in [SSE submission](#backend-streaming-slice-1)
and [SSE attempt retry](#backend-streaming-attempt-retry-task-27).
The current web screen consumes SSE submission and uses history polling for
recovery when no matching live stream exists. Verification uses
synthetic credentials and responses; no paid calls, email connection, or
background jobs are involved.

Task 3.1 now adds the validated browser conversation client and session isolation.
See [the conversation UI plan](conversation-ui-plan.md#checkpoint-1-implementation-and-usage)
for its request scope, cache keys, history-version guards, and focused verification.
Task 3.2 renders the continuous transcript, pagination, and run details in a
monochrome workspace. Owner messages align right and Mentor replies
align left. The approved sending portion of task 3.3 now enables the composer,
retains rejected drafts, reconciles uncertain delivery, and polls persisted work.
Browser retry now streams another attempt on the latest failed/interrupted
message while preserving the independent composer draft. Clear history and full
interaction/auth acceptance remain later slices; task 3.3 is still open.

See [the sending checkpoint](conversation-ui-plan.md#checkpoint-3a-sending-and-delivery-recovery)
for the UI state transitions, module responsibilities, and verification limits.
Enter sends and Shift+Enter inserts a newline; IME composition does not submit.
You may write the next draft while an accepted attempt runs, but Send waits for
the run to finish. A confirmation timeout or connection error keeps the original
text and request ID. Automatic recovery reads history only; the explicit
Check or resend control checks current history before replaying that same request.
This replay recovers delivery and never creates a fresh attempt for a failed run.
Unsent drafts are not durable and are cleared on reload, logout/session change,
or observation of a new history version. Accepted messages remain in PostgreSQL.

## Current browser reading order

The current retry checkpoint is tasks 3.3f–3.3g, building on the completed
submission readability checkpoint (3.3b–3.3e). Start in
`apps/web/src/features/conversation/`:

1. `conversation-workspace.tsx` composes history, submission, and presentation.
2. `state/submission-state.ts` defines valid delivery states, named transitions,
   failure categories, and typed notices. Unresolved states own their original
   send command or target turn plus `RetryInput`; accepted work and the next
   draft have independent lifetimes. `retryableTurnId` selects the newest eligible
   turn from saved history.
3. `state/conversation-submission.ts` coordinates the POST, committed publication,
   confirmation timer, history reads, reader cancellation, and subscriptions.
   It caches the state projection for React's external-store subscription.
4. `state/use-conversation-submission.ts` connects that coordinator to React and
   the query adapter. `state/conversation-polling.ts` decides when recovery polls.
5. `state/conversation-queries.ts` owns saved cache updates;
   `state/conversation-scope.ts` and auth's `session-scope.ts` reject obsolete work.
6. `api/conversation-stream-api.ts` validates event order and identities;
   submit validates message text/key, while retry validates turn/attempt key.
   Both share `api/conversation-stream-reader.ts` for framing, timeout, and bounds.
7. `ui/conversation-composer.tsx` consumes the projected snapshot;
   `ui/conversation-transcript.tsx` displays saved turns and ephemeral response text.

For a concrete trace, send “Explain database locks” with request ID `R1` and
history version `0`. Sending captures the exact text/version/key in its delivery
state. An `accepted` event publishes the committed running snapshot, ends the
15-second confirmation wait, and clears that submitted draft. The owner can now
type “Show an example” while deltas build a separate temporary answer.

If the reader disconnects, `loseStream` discards only the temporary answer and
keeps “Show an example”. The coordinator reads history; a running saved attempt
without a live stream uses two-second foreground polling. When history returns
the completed answer, it replaces the partial response and clears the stream-loss
notice. There is still one POST for `R1`; recovery reads never start another run.
The next draft survives throughout. A saved terminal outcome also aborts an
obsolete reader, and late callbacks cannot restore its text.

If acceptance itself was lost, the delivery state instead keeps the original
`R1` input locked. Only the owner's Check or resend action may POST again, after
reading current history, with that identical key/text/version. A failed check
sends nothing. Session loss clears private state; a new history version discards
pre-clear input and never replays it into the replacement history.

See the [transition/test map and current verification](conversation-ui-plan.md#submission-readability-checkpoint-tasks-33b33e).
The dated checkpoints below describe evidence from earlier slices. Clear history
controls, integrated authentication/database/proxy acceptance, and public-web
investigation remain later work.

For retry, the original turn `T1` keeps submission key `R1` and its failed
attempt. Clicking **Retry response** creates a typed retry operation for `T1`
with fresh key `R2` and the current history version; it never takes text from the
composer. The retry stream validates `attempt.requestId === R2`, publishes saved
acceptance, and displays deltas on the same message. Acceptance preserves the
current draft, including any next draft edited while the response streams.

If that reader disconnects, history reads find `R2` among `T1`'s attempts and
recover its saved result. The failed `R1` attempt cannot settle `R2`. If acceptance
was lost and history still lacks `R2`, only **Check or resend retry** may replay
the identical `T1/R2/version` command after a successful fresh read. A failed
check sends nothing. Replay returns saved state without a live attachment, so a
running replay uses foreground polling. A healthy live retry stream does not
poll. A new intentional retry after another failure gets another fresh key.

See [browser retry verification](conversation-ui-plan.md#sse-attempt-retry-tasks-33f33g).

## Backend reading order

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
8. `adapters/openai-conversation.model.ts` uses the standard SDK Responses model,
   one Mentor agent, and a runner, then maps SDK results to application outcomes.
9. `tests/unit/openai-conversation-model.test.ts` runs the actual pinned SDK and
   official client against `tests/fixtures/responses-stub.ts`.
10. `apps/api/src/conversation/infrastructure/conversation.module.ts` composes
    server configuration, the Drizzle repository, and the SDK adapter into one
    injectable ConversationLoop and registers the protected controllers.
11. `tests/integration/conversation-sdk.test.ts` verifies the composed lifecycle
    against disposable PostgreSQL and the localhost Responses stub.
12. `apps/api/src/conversation/adapters/driving/http/conversation.controller.ts`
    declares routes and OpenAPI metadata, obtains the session owner, calls
    ConversationLoop, and maps results to response DTOs. JSON content-type checks
    and query-string decoding stay at this HTTP boundary. ConversationLoop uses
    `packages/backend/src/conversation/application/conversation.validation.ts`
    to validate commands and numeric history options with Zod before accessing
    persistence or the model. Ownership is passed separately from untrusted
    commands; supplied owner/turn selectors are rejected. Admission, retry,
    context, and completion rules also stay in the backend. Ordinary JSON routes
    call the use case directly. `conversation.presenter.ts` shares DTO mapping
    between those routes and `ConversationStreamService`, which owns streaming
    event mapping, post-header errors, and response cleanup in the HTTP adapter.

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
with only the affected configuration key names inside server composition. Values
and raw Zod errors are excluded. The HTTP status endpoint omits even those key
names: disabled execution returns `{ "enabled": false, "limits": null }`.
This keeps a configuration problem from preventing access to stored history.

Enabled configuration contains the server key separately from plain `RunLimits`.
Only the provider adapter receives that key. Core use cases and model request
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
cap. The selector checks initial serialized transcript bytes. The SDK manages
request serialization and intermediate context; there is no complete request-byte
check in the adapter. The database
still permits only one running attempt per owner; no daily attempt cap is added.
`allowedTools` is empty in this environment reader. Runtime-controlled public-web
permission and observed activity remain in their later checkpoint.

`ConversationLoop` now receives either `{ enabled: false }` or
`{ enabled: true, model, limits }`. The disabled branch needs neither model nor
limits. Submit and retry reject with `EXECUTION_UNAVAILABLE` before repository
admission, so no user turn or run is added. History reads and versioned clearing
remain available. Enabled execution retains the existing input checks, replay,
deadline, cancellation, and conditional completion behavior.

These branches are verified through SDK/database composition and actual protected
HTTP requests with synthetic configuration. Set the server key and an explicit
account-available model in the existing environment and restart the API; settings
are read at startup. Valid configuration allows authenticated submit/retry requests
to call OpenAI and incur charges. No default model or live call is assumed by the
tests. Browser submission and draft preservation remain task 3.3; the workspace
currently supports history reading and run inspection.
`.env.example` documents defaults; an existing `.env` is left untouched.

## Standard Agents SDK adapter (tasks 2.2a–2.2c)

The backend pins `@openai/agents` **0.21.0** and `openai` **7.43.0**. The SDK's
client dependency is `^7.2.0`; both resolve to the pinned official client. Root
SDK/client dependencies support contract tests. Undici **7.24.3** lets those tests
deny non-stub connections.

`@mentor/backend/conversation/model` exports `OpenAIConversationModel`. It creates
an unmodified `OpenAIResponsesModel`, one Mentor `Agent`, and a `Runner`. SDK
imports remain in the adapter; application/domain code and the browser do not
import the SDK. The default endpoint is explicitly `https://api.openai.com/v1`.
Transport overrides allow a localhost stub in tests. Construction sends no request.

```text
ConversationModel.complete: explicit model, selected messages, settings, signal
    --> standard SDK Responses model + Mentor Agent + Runner
    --> SDK serializes requests and manages model/tool iterations
    --> SDK final output and reported usage
    --> normalized application outcome; discard raw SDK state
```

At the owner's request, the custom RunBudget policy and Responses request subclass
were removed. There is no configurable model-call allowance, cumulative output or
hosted-tool counter, extra initial-context trimming, request-byte enforcement,
strict raw-response schema, or custom final-answer byte cap. The adapter forwards
the application's selected transcript and lets the SDK manage intermediate items.

The SDK's default iteration limit is ten in pinned version 0.21.0; the adapter does
not pass `maxTurns`. `AI_MAX_OUTPUT_TOKENS` goes directly to the normal SDK
`maxTokens` setting on each model call. A second call receives the same setting;
it does not subtract earlier usage. The application still bounds the initial
transcript, allows one active attempt per owner, and aborts at its persisted
deadline. The initial transcript bound excludes instructions, tool definitions,
SDK serialization overhead, and intermediate results. There is no whole-run token
or hosted-tool guarantee. `AI_MAX_TOOL_CALLS` remains reserved for the later
per-request search configuration; production has no registered tools now.

Privacy and retry settings remain explicit:

- `store: false` on the agent's model settings, without an SDK session or
  provider-managed conversation/response-ID chain.
- Official client `maxRetries: 0` and SDK `retry.maxRetries: 0`.
- Global tracing disabled, empty trace processors, and runner tracing disabled
  with sensitive data excluded.
- SDK sensitive logging disabled programmatically and official-client logging off.

Tracing/logging controls are process-wide. `store: false` does not promise zero
provider retention. The official [running-agents guide](https://developers.openai.com/api/docs/guides/agents/running-agents)
and [model guide](https://developers.openai.com/api/docs/guides/agents/models)
describe the SDK loop and standard model settings. Dependency upgrades must rerun
the contract tests.

The adapter returns the SDK's `finalOutput` when it is nonempty text. SDK refusals,
incomplete output, iteration-limit exceptions, provider failures, and cancellation
map to stable application error codes without exposing exception text or raw SDK
state. `LIMIT_EXCEEDED` now describes the SDK iteration-limit exception. There is
no additional raw-response validation layer.

Usage comes from the SDK's aggregate `Usage` object. Each run receives a fresh SDK
RunContext so already-reported counts remain available even if a later provider
error carries no SDK exception state. This is the SDK's own aggregate; the adapter
does not count tokens or calls independently. The SDK may normalize absent provider counts to zero;
we accept that behavior and treat these as SDK-reported metrics, not audited
provider totals. Missing usage does not stop another SDK step. When no SDK usage
is available, the outcome leaves it unavailable. Task 2.3 persists supplied usage
for failed and interrupted outcomes as well as completed answers. An interruption
that wins the application abort race may have no SDK outcome/usage available;
counts remain null. Clearing history removes the attempt and its usage entirely.
Existing terminal-state and deadline checks continue to reject late publication.

The contract suite uses the actual SDK/client and a localhost HTTP stub with a
synthetic key. It verifies context, privacy settings, no retries, SDK results and
errors, per-call output configuration, the default iteration limit, cancellation,
and SDK usage. Synthetic tools force multiple steps only in tests. Fetch and
Undici guards detect/deny non-stub traffic, including code that captured native
fetch before setup. Interception stays active through trace flushing and SDK
shutdown. A restricted sandbox may require permission to bind localhost.

## Follow one message

Suppose the owner says, "Discuss this security notice."

```text
POST /api/v1/conversation/turns: request UUID, history version, text
    --> global guard: session + exact Origin + session-bound CSRF
    --> controller: session owner + raw command, separate arguments
    --> ConversationLoop.submit: Zod application validation + execution readiness
    --> repository.submit: commit user turn + running attempt
    --> repository.context: recent completed turn pairs
    --> selectContext: chronological bounded messages + omission flag
    --> ConversationModel.complete: Agents SDK Runner + Responses, outside transactions
    --> repository.finish: save outcome only if still current and in time
    --> controller: map turn + persisted attempt + history version to HTTP DTOs
```

The controller derives owner identity from the session and passes it separately
from the unknown command. Application schemas reject supplied owner/turn selector
fields, invalid UUIDs, unsafe versions, and unknown properties. Controllers handle
HTTP content type, decimal query-string decoding, and response mapping; application
code has no NestJS, request/response, ORM, or SDK imports. The module composes the
use case with the real repository and standard SDK adapter. No intermediate HTTP
service is needed.

The first submission automatically creates the singleton conversation. A history
read before then returns an empty transcript without inserting a row. PostgreSQL
enforces a unique owner foreign key. Returning later or changing topic continues
the same sequence of turns.

## Protected API contract

All paths below have the `/api/v1` prefix and require a valid session. Responses
use `Cache-Control: private, no-store`. Mutations require JSON, the exact configured
Origin, and `X-CSRF-Token` from `/api/v1/auth/csrf`, fetched with the current session
cookie. The signature is session- and process-bound; fetch a fresh one after login
or API restart. Browser requests use the existing same-origin Next.js `/api/*`
proxy; the frontend never needs the provider key or a backend-package import.

| Method/path                                      | Input                                                                                             | Successful response                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET `/assistant/status`                          | None                                                                                              | `enabled` and safe `limits`, or null limits when disabled        |
| GET `/conversation`                              | Optional `limit` (default 20, range 1–100); optional paired `historyVersion` and `beforeSequence` | Version, chronological turns with all attempts, and `nextCursor` |
| POST `/conversation/turns`                       | `text`, `requestId` UUID, `historyVersion`                                                        | Version, one turn, and the request's attempt                     |
| POST `/conversation/turns/stream`                | Same body as JSON submission                                                                      | SSE admission, provisional text, and saved result                |
| POST `/conversation/turns/{turnId}/retry`        | `requestId` UUID and `historyVersion`; turn UUID in path                                          | Same result shape, with a fresh attempt or the replayed retry    |
| POST `/conversation/turns/{turnId}/retry/stream` | Same body and path parameter as JSON retry                                                        | SSE admission, provisional text, and saved retry result          |
| DELETE `/conversation/history`                   | `historyVersion` in JSON body                                                                     | Incremented `historyVersion`                                     |

No conversation ID or owner ID is accepted from the browser. There are no create,
list, rename, or select-conversation routes. GET never starts or resumes model work;
it may reconcile an expired attempt. History pages load newest first, with each
page's turns in chronological order. Pass both values from `nextCursor` to load
older turns; null means there are no older turns.

For example, this submission body contains only application command fields:

```json
{
  "text": "Discuss this security notice.",
  "requestId": "c3db53ee-2607-4f4a-99ad-f7abed417036",
  "historyVersion": 0
}
```

Use the version actually read from history, not a hardcoded zero. Matching replay
uses the same key, text, and version. It returns existing state without another
runner. An explicit retry after failure uses a fresh key; reconciling that retry
reuses its key. Both JSON POST operations normally wait for completion, but a replay
can return a still-running attempt. Responses omit internal execution flags, raw
SDK state, hidden reasoning, and provider exception text. Dates are ISO strings;
available SDK usage is retained, including unsuccessful attempts.

Conversation operation failures use the stable `{ statusCode, code, message }`
envelope:

| HTTP status | Codes                                             | Caller behavior                                           |
| ----------- | ------------------------------------------------- | --------------------------------------------------------- |
| 400         | `INVALID_INPUT`; `BAD_REQUEST` for malformed JSON | Correct input; do not resubmit unchanged                  |
| 401         | `UNAUTHORIZED`                                    | Return to sign-in and discard private client state        |
| 403         | `FORBIDDEN`                                       | Refresh session-bound CSRF and check the browser Origin   |
| 404         | `NOT_FOUND`                                       | The turn does not exist for this owner                    |
| 409         | `BUSY`                                            | Wait for the active attempt                               |
| 409         | `STALE_HISTORY`                                   | Reload history; do not replay cleared content             |
| 409         | `IDEMPOTENCY_CONFLICT`                            | The key was used with different input; preserve the draft |
| 409         | `NOT_RETRYABLE`                                   | Only the latest unsuccessful turn can be retried          |
| 413 / 415   | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE`    | Reduce the request / send JSON                            |
| 503         | `EXECUTION_UNAVAILABLE`                           | Preserve unsent text; history remains readable/clearable  |

Accepted model failures are different from rejected operations: the HTTP response
is 200 with an attempt in failed/interrupted state and a redacted `errorCode`, such
as `REFUSED`, `INCOMPLETE`, `PROVIDER_ERROR`, `RATE_LIMITED`, `LIMIT_EXCEEDED`, or
`INTERRUPTED`. They do not use authentication's sign-in rate-limit message. Unknown
server failures use the existing generic 500 envelope.

DTOs in `apps/api/src/conversation/adapters/driving/http/conversation.dto.ts`
describe OpenAPI. Runtime validation lives in the application schemas. Regenerate
the document and browser contract after DTO/route changes:

```bash
pnpm build:services && pnpm api:generate
```

Do not hand-edit `packages/api-client/openapi.json` or
`packages/api-client/src/generated/schema.ts`.

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
they supplement the SDK adapter's outcome/error mapping.

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
message/initial-context bounds, per-call output settings, deadline, and concurrency
checks remain. Limits are
injected values here. The API's ConversationModule reads server configuration at
startup and creates the repository and SDK adapter through createConversationLoop.
Disabled configuration creates only the repository and disabled use case. Module
initialization, reads, and reconciliation never start SDK work. The singleton use
case tracks local cancellation; database admission still coordinates multiple
API instances. Protected controllers resolve the owner from the authenticated session.

## Expiry and interruption

The repository obtains time from PostgreSQL after acquiring the owner lock.
Deadlines are persisted. History reads and new admissions mark expired running
attempts interrupted. Completion checks state and deadline again, including a
database-clock condition on the update, so a late answer cannot become successful.

The use case also aborts the provider signal at the deadline and stops waiting
even if a fake provider ignores cancellation. Errors are normalized without
returning their private exception payloads. Provider work is never automatically
retried. The HTTP adapter does not use browser disconnect as a cancellation signal;
work can continue in the local API process after a lost connection.

This is foreground execution. If the process dies after admission, a later read
will eventually expose an interrupted attempt. It does not automatically resume
paid work. Reliable unattended execution will need the later worker slice.
The worker currently serves health checks only. Refreshing or polling history is
safe and never auto-resumes uncertain provider work. An explicit retry is a fresh
attempt from application-owned completed context and may incur another charge.
Persisted expiry is reconciled on reads/admissions, not by a background timer that
survives a process crash.

## Tool selection

User messages have no investigation flag. Server-controlled `allowedTools`
settings supply available tools to the model port; the assistant decides whether
an available tool is useful. In the later investigation checkpoint, permitted public-web
search will be optional rather than forced on every message. Runtime limits
still apply, and observed attempt activity records what actually happened.
Retries apply current tool permissions rather than restoring old permissions.
The production SDK adapter currently rejects nonempty tool settings. Actual web
search remains group 4; the SDK contract tests use synthetic tools only.

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

The use case bounds the initial transcript passed to the model port. SDK
serialization overhead and later intermediate context follow the SDK's normal
behavior without an extra adapter byte check. Long-term memory, historical retrieval, and
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

Local clearing cannot retract content already sent to a provider.

## Cloud-processing disclosure and current capability boundary

The HTTP API and web composer can execute against OpenAI when configured. At the
owner's request, the cloud-processing line and
expandable Privacy & context section beneath the composer were removed.
Cloud-processing information remains documented here:

> Your message and selected recent conversation context are sent to OpenAI to
> generate a response. Older messages remain in your local history but may be
> omitted from the model's context. When public-web search is permitted, Mentor
> may choose to search and send derived queries to that service. Web search is
> currently unavailable. Clearing history removes Mentor's local conversation
> content; it cannot retract content already sent to a provider. Disabling provider
> response storage does not promise zero provider retention.

There is no persisted acknowledgement or acknowledgement gate. Production tool registration
is empty: this checkpoint cannot search the web, access email/private accounts,
rotate credentials, or perform external writes. Sources/activity fields exist in
the contract but do not prove a tool ran; real observed search normalization is
group 4. Hidden reasoning and raw SDK intermediate items are not stored.

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

The actual HTTP suite covers the production controllers/guard with a model fake;
the composed lifecycle and adapter suites exercise the real SDK/client against
localhost stubs with non-stub outbound traffic denied. Task 3.2 browser checks
exercise the production read-only workspace with synthetic intercepted API
responses on phone and desktop. The sending slice adds 29 browser scenarios and
repeats the 28 workspace regressions with the enabled composer. All of those
browser checks intercept API calls with synthetic responses; they do not exercise
real cookies, PostgreSQL, or a live provider. See [the sending evidence](conversation-ui-plan.md#checkpoint-3a-sending-and-delivery-recovery).
Full retry/clear-history/auth acceptance and live-provider verification remain open;
synthetic search fixtures are not live investigation evidence.

## Application/API checkpoint (task 2.5)

Verified on 2026-11-01 after the documentation update:

- `pnpm check` passes formatting, lint, strict types, all 198 unit/contract tests,
  and the production build.
- `pnpm test:integration` passes all 87 checks, including actual HTTP protection
  and SDK/database composition. Its disposable PostgreSQL container and network
  are removed afterward.
- Regeneration leaves both `packages/api-client/openapi.json` and
  `packages/api-client/src/generated/schema.ts` byte-for-byte unchanged.
- Strict OpenSpec validation passes. Localhost/Docker checks ran with sandbox
  permission. Build-generated Next.js type references are restored afterward.

README and `.env.example` now describe the implemented API, required model/key,
application settings, SDK defaults, tracing/privacy policy, planned UI disclosure,
and foreground-recovery limits. No existing `.env` or development database was
modified, and no live OpenAI call was made. Task 2.5 completes the application/API
checkpoint. The subsequent tasks 3.1–3.2 browser data boundary and read-only
workspace are documented in [conversation-ui-plan.md](conversation-ui-plan.md).
The subsequent approved sending slice is documented in checkpoint 3a of that
guide. Explicit retry, UI history clearing, and full acceptance remain later work.

## Historical verification checkpoints

The dated entries below record the implementation at that time. Earlier statements
about pending routes or checks are superseded by the later application/API evidence.

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

Next.js security follow-up, verified on 2026-10-25: upgraded the web dependency
and lockfile from Next.js 16.4.0 to 16.4.3, including the matching environment and
SWC packages. This includes the fixes from the
[October 14 security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026).
`pnpm check` passes outside the sandbox with 163 unit tests and a successful
production build without the previous security warning. `pnpm test:integration`
passes all 54 checks; its disposable database and network were removed afterward.
`pnpm audit --prod` reports no Next.js advisory, but exits nonzero for four
separate advisories: `js-yaml` (moderate), `zod`, `body-parser`, and `multer`
(high). Those dependencies remain unchanged by this focused update. The earlier
Next.js advisory notes above describe historical checkpoints and are superseded
by this verification.

SDK simplification on 2026-10-25: the owner requested normal SDK behavior and
removal of the stricter budget implementation. The earlier whole-run budget and
custom request-hook verification is historical and superseded by this revision.
The active implementation and limitations are documented above.

The revised checkpoint passes `pnpm check`: formatting, lint, strict types,
all 194 unit/contract tests, and a successful production build. The localhost SDK
tests verify its default ten-iteration limit, unchanged per-call output setting,
SDK-reported usage, contextual follow-up, cancellation, redacted failures, and
privacy settings, with no non-stub traffic during execution, trace flushing, or
shutdown. The removed policy, request subclass, model-call setting, selector
measurement callback, and their stricter-budget tests have no remaining source
references.

`pnpm test:integration` passes all 54 disposable PostgreSQL checks; its container
and network were removed. Strict OpenSpec validation passes. No existing `.env`,
development database, migration, or generated API contract changed. The temporary
build-generated Next.js type references are restored to their incoming values.
Tasks 2.2a–2.2c now describe and verify the simplified implementation. API
composition, conversation UI, and production tools remain later checkpoints.
Verification used synthetic inputs and a local stub; no live OpenAI call was made.

Task 2.3 composition, verified on 2026-10-26: ConversationModule now provides the
use case with the real repository and SDK adapter. Available SDK usage is saved
for unsuccessful outcomes in the existing nullable token columns. Empty-answer
normalization also retains supplied usage. No migration or independent token
accounting was added. The adapter's low-level execution entry is exported through
`@mentor/backend/conversation/model` so integration tests use the declared adapter
boundary for synthetic tools; production composition registers no tools.

The composed SDK/PostgreSQL suite proves contextual follow-up, cross-instance
concurrency/replay, explicit retry with fresh context, deadline cancellation,
configuration-disabled reads/clearing, redacted provider/refusal/incomplete/limit
failures, and aggregate SDK usage on success and failure. Restart recovery is
simulated by leaving a persisted orphaned admission and creating a fresh use case;
reads and replay start no SDK work, expiry records interruption, and only an
explicit retry runs again. Clear-history tests cover both local cancellation
between SDK steps and another API instance clearing without a local abort; late
multi-step completion cannot restore deleted history. Non-stub outbound traffic
is denied through trace flushing and shutdown.

`pnpm check` passes formatting, lint, strict types, all 195 unit/contract tests,
and the production build. After the final integration additions, test typechecking
and lint pass again. `pnpm test:integration` passes all 78 checks against disposable
PostgreSQL, with the container and network removed afterward. Localhost/Docker
verification ran with sandbox permission. Strict OpenSpec validation passes.
Generated OpenAPI/client contracts are unchanged, and build-generated Next.js type
references are restored to their incoming values. No existing `.env` or development
database was changed; no live provider call was made. Task 2.3 is complete; tasks
2.4–2.5, the conversation UI, and public-web tools remain open. Stop here for review;
commit when requested.

Task 2.4 protected HTTP API, verified on 2026-11-01:

- `GET /api/v1/assistant/status` returns readiness and safe execution settings;
  disabled execution returns null limits without configuration diagnostics.
- `GET /api/v1/conversation` returns the owner's transcript. Optional `limit`
  is 1–100; pagination uses both `historyVersion` and `beforeSequence` from
  `nextCursor`. Initial reads return an empty transcript without creating rows.
- `POST /api/v1/conversation/turns` accepts `text`, `requestId`, and
  `historyVersion`. It executes in the foreground or returns the persisted
  attempt on replay, including running state, without another model call.
- `POST /api/v1/conversation/turns/{turnId}/retry` accepts `requestId` and
  `historyVersion` for an explicit fresh attempt on the latest retryable turn.
- `DELETE /api/v1/conversation/history` accepts the observed `historyVersion`
  in JSON and returns its incremented value after clearing.

All routes use the existing session guard and private/no-store headers. Mutations
require the configured Origin and session-bound CSRF token. Ownership comes from
the session; supplied owner/conversation selectors and unknown body/query fields
are rejected. Missing turn IDs return 404. Conversation validation returns
`INVALID_INPUT` (400); malformed JSON returns `BAD_REQUEST` (400). Busy, stale
history, conflicting request keys, and non-retryable turns return distinct 409
codes. Disabled execution returns `EXECUTION_UNAVAILABLE` (503). Admitted model
failures remain attempt outcomes in a 200 response, with redacted error categories.
The transport omits the internal admission execution flag and raw SDK/provider
state. UUIDs, integer versions, paired cursors, text, and UTF-8 message bounds are
validated before model work.

`tests/integration/conversation-http.test.ts` starts the production application
factory on localhost with real session/CSRF protection and disposable PostgreSQL.
Only the model boundary is faked; the adapter and SDK composition remain covered
by their existing HTTP-stub suites. Nine new HTTP checks cover authorization and
expiry, Origin/CSRF, private caching, selector rejection and missing turns,
validation, completed/running replay, concurrency, explicit retry, pagination,
stale versions, redaction, and disabled reads/clearing. `pnpm check` passes all
195 unit/contract tests and the production build; `pnpm test:integration` passes
all 87 checks and removes its disposable database container/network. These checks
required localhost/Docker access outside the sandbox. No live OpenAI call was
made. Task 2.4 is complete; task 2.5 documentation completion and the UI/public-web
slices remain open. Stop here for review; commit when requested.

Validation follow-up: ConversationLoop now validates commands and history options
with application-owned Zod schemas. Controllers retain response mapping and HTTP
decoding; the intermediate HTTP service was removed. Direct use-case tests cover
malformed commands, supplied owner selectors, and invalid numeric history options
before repository/model work. After this refactor, `pnpm check` passes all 198
unit/contract tests and the production build, and `pnpm test:integration` passes
all 87 checks. Regeneration leaves the HTTP contract unchanged.

## Backend streaming slice 1

Task 2.6 adds `POST /api/v1/conversation/turns/stream`. Send the same JSON
`{ text, requestId, historyVersion }` command as the existing submission route,
with the signed-in session cookie, configured Origin, and session-bound
`X-CSRF-Token`. Consume the response body incrementally through fetch. The
existing JSON route remains compatible. Browser streaming is described below.

The controller checks the request media type, obtains the session owner, and
delegates to `ConversationStreamService` in the HTTP adapter. That service calls
`ConversationLoop.submit`, translates progress/results into HTTP events through
shared presenters, maps post-header failures, and closes the writer in `finally`.
`ConversationStream` handles SSE framing, headers, heartbeats, and bounded socket
buffering. Admission, deadlines, context selection, and persistence rules remain
in `ConversationLoop`; the streaming service adds no application policy.

The backend commits admission before starting the SSE response. Authentication,
CSRF, input, disabled execution, stale version, busy, and idempotency-conflict
errors use the normal JSON HTTP status/envelope before SSE headers. Successful
admission returns `text/event-stream; charset=utf-8`,
`Cache-Control: private, no-store, no-transform`, and `X-Accel-Buffering: no`.
Comment heartbeats are emitted every 15 seconds during idle periods.

Each frame has an event name and one JSON data line with a matching `type`:

| Event        | JSON data                                                          | Meaning                                                                 |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `accepted`   | `type`, `replayed`, `historyVersion`, `turn`, `attempt`            | Admission is committed; a replay describes existing state               |
| `text_delta` | `type`, `historyVersion`, `turnId`, `attemptId`, `delta`           | Provisional answer text for this attempt/version                        |
| `result`     | `type`, `historyVersion`, `turn`, `attempt`                        | Current saved result, with normal sources/activity/context/usage fields |
| `error`      | `type`, `historyVersion`, `turnId`, `attemptId`, `code`, `message` | Saved completion could not be confirmed; reconcile history              |

OpenAPI documents the event data DTOs in `components.schemas` and maps the event
names in the response schema's `x-event-schemas` extension. Regenerate these
contracts with `pnpm build:services && pnpm api:generate`; do not hand-edit them.
JSON encoding preserves multiline and Unicode text without inserting extra SSE
frames. Clients must decode UTF-8 and SSE frames across arbitrary HTTP chunks.

`ConversationLoop.submit` accepts an optional synchronous progress observer.
It emits committed admission and version/attempt-scoped text progress without
HTTP or SDK dependencies. `ConversationModel.complete` accepts an optional
`onTextDelta`; the adapter opts into the pinned SDK's streaming runner only when
that callback is present, forwards answer-text deltas, consumes the entire run,
and maps the final SDK output/usage/errors as before. SDK events, raw errors,
and hidden reasoning do not cross the application boundary.

Text deltas are temporary display data. No partial answer is written to
PostgreSQL or included in future context. A `result` for fresh work follows the
conditional database completion and can represent completed, failed, or
interrupted work. A replay emits `accepted` with `replayed: true`, then `result`
with the current persisted state, which may still be running, and closes. It
does not subscribe to the original stream, replay missed deltas, or start another
SDK runner. A stream close alone is never proof of completion.

Provider failure after text produces a saved unsuccessful result with no answer;
available SDK usage remains persisted. Failures after headers that prevent
confirmed persistence emit only a fixed `INTERNAL_ERROR` or `STALE_HISTORY`
stream error. Never treat previously received text as a completed answer in
those cases. Session/history guards and provisional rendering are implemented in browser
streaming slice 2; complete recovery acceptance remains slice 3.

The original request handler awaits execution even if its reader disconnects.
Reader failures and observer exceptions cannot cancel or replace the run. A
64 KiB bound on queued response bytes detaches slow readers; it does not impose
an answer-size or model budget limit. Detached clients recover through saved
history. The application deadline and history-clear abort still reach the SDK;
late deltas from settled/cancelled local runs are suppressed. Across API
processes, conditional persistence protects cleared history; version tags allow
clients to discard stale delivery when they observe a newer version. This adds
no durable worker, shared stream registry, reconnect cursor, or token replay.
API crashes still rely on persisted deadline reconciliation.

Verification uses the actual pinned SDK and official client against a localhost
Responses SSE stub, injected model fakes at the real authenticated HTTP boundary,
and disposable PostgreSQL. It covers text arriving before completion, saved
final answer/usage, failure after deltas, replay without another runner, JSON
admission errors, redacted post-header errors, disconnect continuation, local
clear/deadline suppression, heartbeat cleanup, and bounded reader buffering.
No live provider calls, development-data operations, or migration are required.
Delivery through the actual Next.js proxy and smooth UI rendering remain later
acceptance checks; headers alone do not establish end-to-end proxy behavior.

Verified locally on 2026-11-01: `pnpm check` passes formatting, architecture
lint, strict types, all 285 unit/contract tests, contract generation, and the
production build. `pnpm test:integration` passes all 95 checks and removes its
disposable database container/network. Localhost/Docker checks used the permitted
execution path. Generated event references/discriminators were checked; all
existing API paths and DTOs are semantically unchanged. Strict OpenSpec validation
passes. No live OpenAI call, existing `.env` edit, database migration, or
development-data operation occurred. Task 2.6 is complete; browser streaming and
end-to-end recovery/proxy acceptance remain open. Stop here for review; commit
when requested.

## Backend streaming attempt retry (task 2.7)

`POST /api/v1/conversation/turns/{turnId}/retry/stream` accepts the existing
retry JSON body `{ requestId, historyVersion }`, with the same session, Origin,
and CSRF protections. It streams `accepted`, `text_delta`, `result`, and `error`
using the existing event shapes, headers, heartbeats, and buffering limits.
The compatible JSON retry route remains available. The backend-only task-2.7
checkpoint preceded the browser control now implemented in task 3.3f.

Follow the request through these files:

1. `apps/api/src/conversation/adapters/driving/http/conversation.controller.ts`:
   `retryStream` checks the media type, takes ownership from the session, and
   delegates to the stream service. Both streaming routes share response metadata.
2. `conversation-stream.service.ts` in the same directory: explicit `submit` and
   `retry` entry points use one delivery lifecycle for progress mapping, redacted
   errors after SSE starts, and cleanup.
3. `packages/backend/src/conversation/application/conversation-loop.ts`:
   `retry` validates the existing command, admits through the unchanged repository
   rules, and forwards the optional observer to the shared execution path. The
   model adapter enables SDK streaming when text progress is requested.

For example, a failed turn keeps its original message and submission request ID.
An intentional retry supplies a fresh request ID and creates attempt 2. The
accepted event carries that new ID in `attempt.requestId`; `turn.requestId` still
identifies the original message. Text events identify the accepted turn/attempt,
and the result is sent only after conditional persistence. Prior attempts remain
inspectable, and failed partial text never becomes durable answer context.

If the reader disconnects, delivery detaches while bounded execution and
persistence continue. History can reveal attempt 2's saved outcome. Reposting
the same retry key returns accepted/result snapshots with `replayed: true`, even
for a running attempt, without starting another runner or attaching to its live
text. Matching completed retry keys remain replayable after newer messages.
Fresh retries still require the newest failed/interrupted turn. History-version
and execution-availability checks continue to apply to replay.

Admission failures remain JSON before SSE headers. Deadline and history clearing
suppress late text/publication; failures after headers use a redacted error event
or a saved unsuccessful result. No schema migration or SDK policy change is needed.

Verification on 2026-11-08:

- `pnpm check` passes formatting, lint, strict types, all 335 unit/contract tests,
  API generation, and the production build. The initial sandbox run could not
  bind localhost for the SDK stub; rerunning with localhost access passed.
- `pnpm test:integration` passes all 104 checks using disposable PostgreSQL,
  production HTTP routes/guards with injected execution, and the actual SDK
  against localhost stubs. Docker access required execution outside the sandbox;
  the test runner removed its own container/network/volume after verification.
- Added retry coverage checks early text, successful/failed SDK usage, JSON
  compatibility, running/completed replay including after newer turns, admission
  rejection, redaction, reader/observer isolation, and deadline/clear suppression.
  Existing submit streaming cases also remain verified.
- Strict OpenSpec validation and `git diff --check` pass. Comparing generated
  OpenAPI against the preceding contract shows only the added retry streaming
  route; existing paths and schemas are unchanged. No migration was added.

No browser acceptance, live model calls, development-data operations, or `.env`
changes occurred. Task 2.7 completed the backend-only review stop requested by
the owner. Tasks 3.3f–3.3g subsequently added and verified browser retry, as
documented in the current reading order and conversation UI plan.

## Browser streaming slice 2

The browser now consumes the SSE endpoint. Committed acceptance clears the
submitted draft before generation finishes, and provisional text appears in the
matching running response. The next draft survives final completion. Temporary
text remains outside saved history; a persisted final or failed result replaces
it. A successful HTTP status or EOF without a valid result does not establish
completion.

Polling pauses while the browser has a matching live stream. After reload,
running replay, disconnect, invalid stream data, or a silent connection, it reads
saved history every two seconds in the foreground until the attempt settles.
Recovery never automatically resends a message or resumes a model run. A stream
reader closes on session/history changes; late events cannot restore private
content. Full recovery/authenticated API acceptance remains a separate slice.

See [browser streaming evidence](conversation-ui-plan.md#checkpoint-3b-browser-streaming-slice-2-task-33a)
for module responsibilities, deterministic checks, synthetic browser verification,
and its limits. Browser tests use synthetic output, not live provider responses.
