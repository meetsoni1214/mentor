# Conversation loop

Mentor provides one continuous conversation per owner, with persistent history,
streamed answers, explicit retry, Clear history, hosted web search, and validated
citations. New attempts use [active personal memory](personal-memory.md) and
bounded recent context. There is no thread creation or selection.

## Follow a message

The request path is browser → Next.js rewrite → authenticated NestJS controller
→ `ConversationLoop` → persisted admission → bounded context → Agents SDK
→ conditional database completion. PostgreSQL owns history and attempt state.
The SDK has no durable session or cross-turn provider conversation.

Admission locks the owner row, checks the history version, resolves request-key
replay/conflicts, and permits at most one active attempt per owner. A turn holds
the accepted user message; attempts hold its running/completed/failed/interrupted
responses. Retrying keeps the turn and creates a fresh attempt only for the
latest unsuccessful turn. Provider execution happens outside the transaction.

Completion checks the persisted deadline, current history version, and attempt
state before saving. A process crash can leave work running until a later read
reconciles its expired deadline as interrupted. The worker does not resume it.

## Protected API contract

All routes below are under `/api/v1`, require the existing session, and return
private/no-store responses. Mutations require JSON, exact `APP_ORIGIN`, and a
session-bound `X-CSRF-Token`. Ownership comes from the session.

| Method | Path                                        | Input / purpose                                                                                     |
| ------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/assistant/status`                         | Execution readiness and safe limits                                                                 |
| GET    | `/conversation`                             | History; optional `limit` (1–100, default 20) and paired `historyVersion` / `beforeSequence` cursor |
| POST   | `/conversation/turns`                       | `{ text, requestId, historyVersion }`                                                               |
| POST   | `/conversation/turns/stream`                | Same command with SSE delivery                                                                      |
| POST   | `/conversation/turns/{turnId}/retry`        | `{ requestId, historyVersion }` with a fresh retry UUID                                             |
| POST   | `/conversation/turns/{turnId}/retry/stream` | Same retry command with SSE delivery                                                                |
| DELETE | `/conversation/history`                     | `{ historyVersion }`                                                                                |

History pages load newest first, with turns in chronological order within each
page and all attempts retained. Use both values from `nextCursor` for older
pages; null means there are no older turns. Reads never start or resume a model
run. JSON submit/retry normally waits for completion; an exact replay can return
a running snapshot without another model call.

Matching replay requires the same request ID, text/target, and history version.
It recovers delivery; an intentional retry after failure uses a new attempt key.
Available SDK-reported usage is saved for successful and unsuccessful attempts.
Raw SDK state, hidden reasoning, and provider exception text are omitted.

| HTTP status | Error codes                                   | Handling                                           |
| ----------- | --------------------------------------------- | -------------------------------------------------- |
| 400         | `INVALID_INPUT`, `BAD_REQUEST`                | Correct the input                                  |
| 401         | `UNAUTHORIZED`                                | Sign in again; discard private client state        |
| 403         | `FORBIDDEN`                                   | Check Origin and obtain fresh CSRF                 |
| 404         | `NOT_FOUND`                                   | Target turn is unavailable for this owner          |
| 409         | `BUSY`                                        | Wait for active execution                          |
| 409         | `STALE_HISTORY`                               | Read current history; never replay cleared content |
| 409         | `IDEMPOTENCY_CONFLICT`                        | Key was reused with different input                |
| 409         | `NOT_RETRYABLE`                               | Only the latest unsuccessful turn is retryable     |
| 413 / 415   | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Reduce the request / send JSON                     |
| 503         | `EXECUTION_UNAVAILABLE`                       | Preserve the draft; history remains available      |

Rejected operations use `{ statusCode, code, message }`. Accepted execution
failures return saved failed/interrupted attempts with redacted codes such as
`PROVIDER_ERROR`, `REFUSED`, `RATE_LIMITED`, `LIMIT_EXCEEDED`, or `INTERRUPTED`.

Regenerate [OpenAPI/client types](../packages/api-client/openapi.json) with
`pnpm build:services && pnpm api:generate`; do not edit generated output.

## Streaming and browser recovery

The browser uses generated-client POST/fetch streaming with browser-owned event
validation and bounded UTF-8/SSE framing. Authentication/admission errors are JSON
before SSE headers; accepted work returns `text/event-stream` with private/no-store,
no-transform, and no-buffering headers. Idle delivery sends comment heartbeats.

| Event        | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| `accepted`   | Committed admission or replayed saved snapshot               |
| `text_delta` | Temporary text for this history version and attempt          |
| `result`     | Saved current result, including failed/interrupted outcomes  |
| `error`      | Completion could not be confirmed; reconcile through history |

Provisional text never enters the saved query cache, database history, or future
context. Saved terminal results supersede it. A replay returns persisted state
and closes without attaching to another stream or starting a runner. Reader
disconnect or bounded output buffering detaches delivery while admitted execution
continues. A closed stream alone does not prove completion.

Enter sends; Shift+Enter inserts a newline; IME composition does not submit.
Acceptance clears only the submitted draft and ends the 15-second confirmation
wait. The owner can type a next draft while generation runs; completion and retry
preserve that independent draft. Definitive initial rejection preserves unsent
text. Drafts are not persisted and clear on reload, unmount, session replacement,
or observation of a new history version.

Healthy streams pause polling. Unresolved delivery or running work without a
matching stream uses two-second foreground history polling; background polling
pauses. Disconnects, idle timeouts, and invalid events recover through history.
Only explicit recovery may resend the original command after a fresh successful
history read. A failed read sends nothing.

For example, submitting with key `R1` clears that submitted draft on acceptance.
If the stream drops while the owner types a follow-up, history reads recover the
saved answer and preserve the follow-up. If acceptance was lost, recovery retains
the exact original `R1` command. For retry key `R2`, acceptance/recovery matches
`attempt.requestId`, not the original turn key; an older failed attempt cannot
settle the newer retry.

Session generation and history version guard queries, readers, and callbacks.
Replacement cancels obsolete requests and removes private caches, drafts,
unresolved commands, and provisional content. Browser local/session storage holds
no transcript.

## Clear history

The header opens one confirmation directly. Clearing is available while an answer
runs or execution is disabled. The versioned DELETE removes messages, attempts,
and embedded evidence, advances the history version, and preserves explicit
memories. It cannot retract content already sent to a provider.

Confirmed clearing hides old content, detaches delivery, discards obsolete private
state, and reads actual current history. A newer message from another tab must
survive; the browser never assumes the new history is empty. A failed post-clear
read keeps old content hidden and offers read-only recovery.

If the DELETE response is lost, **Check history** reads without deleting. A
same-version result does not prove the pending clear failed. **Retry original
clear** repeats only the originally confirmed version. A newer-version read
settles uncertainty; deleting that newer version requires another confirmation.
A definitive initial rejection preserves the draft and active delivery.

Persisted version checks reject stale submissions, retries, pages, repeated clear
requests, and late completion. Local provider work is aborted when possible;
other processes cannot restore cleared content through completion.

## AI configuration and context

Set server-only `OPENAI_API_KEY` and an explicit account-available
`OPENAI_CHAT_MODEL`, then restart the API. There is no default model or enable
flag. Missing/invalid configuration disables execution while history and memory
management remain available. Authenticated status exposes safe limits, never
credentials or internal configuration diagnostics.

| Setting                | Default | Accepted integer range |
| ---------------------- | ------- | ---------------------- |
| `AI_MAX_MESSAGE_BYTES` | 8,192   | 1–65,536               |
| `AI_MAX_CONTEXT_BYTES` | 32,768  | 128–262,144            |
| `AI_MAX_OUTPUT_TOKENS` | 2,048   | 1–32,768               |
| `AI_DEADLINE_MS`       | 60,000  | 100–300,000            |
| `AI_MAX_TOOL_CALLS`    | 2       | 1–10                   |

The context limit must be at least the raw message limit. Context selection
reserves the complete serialized active profile and current question, then fits
whole recent eligible completed exchanges, up to 100 pairs. Selection stops at
the first pair that cannot fit and reports `contextLimited` when history is
omitted. Failed/interrupted partial answers are excluded. Visible history is
independent of the model context window.

A memory mutation atomically advances `context_start_sequence`, excluding older
user and assistant restatements while retaining their visible history. New
exchanges accumulate after the boundary. Clear history resets sequence/boundary
for the new version and keeps active memories. Ordinary replay returns its saved
snapshot; intentional retry reads current memory. If the entire profile plus
current input cannot fit, the admitted attempt fails with `LIMIT_EXCEEDED` before
a provider call. The profile is never silently truncated.

The adapter uses the pinned SDK's standard Responses model, agent, and runner.
It preserves SDK default iterations and sends the normal output limit on each
model call. Hosted-tool limits use `providerData.max_tool_calls` per Responses
request. These settings and the persisted deadline are not cumulative token,
tool, or spending caps. Initial context accounting excludes governing
instructions, tool definitions, SDK overhead, and later intermediate results.

Provider retries and tracing/export are disabled; `store: false` does not promise
zero provider retention. Messages, active saved wording, and selected recent
context go to OpenAI. There is no provider session or `previous_response_id` chain.
Cloud-processing details stay in documentation; the removed composer privacy
footer remains absent.

## Search and citations

Valid AI configuration always offers the SDK's hosted `web_search` tool with
automatic tool choice. There is no separate flag or per-turn toggle. Production
has no email/private-account access, credential rotation, monitoring, or external
write tools. Search availability does not prove a search occurred.

`openai-conversation.evidence.ts` normalizes observed hosted operations and URL
annotations from the exact final answer into at most 20 activity/source records.
Sources require completed observed web activity and safe HTTP(S) destinations.
Unknown shapes, unsafe URLs, invalid/conflicting positions, and fabricated prose
are not promoted to evidence. Several sources can share a citation marker.

Optional paired `startIndex`/`endIndex` positions refer to saved-answer UTF-16 code
units with an exclusive end. The browser validates them again. Final answers show
validated inline citations and a source list; legacy records without positions
remain readable. Ordinary generated links and HTML stay inert, images are not
fetched, and provisional text has no clickable sources. Observed search with no
usable references is reported as such.

Answer, activity, sources, and usage commit together. Raw search queries, pages,
SDK continuation items, and reasoning stay ephemeral. Citations establish recorded
attribution, not universal factual accuracy or private-account findings.

## Code reading order

Start under `apps/web/src/features/conversation/`:

1. `conversation-workspace.tsx` composes history, submission, memory, and UI.
2. `state/submission-state.ts` defines delivery states, clear/retry transitions,
   typed notices, and the independent next draft.
3. `state/conversation-submission.ts` coordinates HTTP, history/cache publication,
   confirmation timers, reader cancellation, and subscriptions.
4. `state/conversation-queries.ts`, `conversation-scope.ts`, and
   `conversation-polling.ts` own saved caches, version guards, and recovery reads.
5. `api/conversation-stream-api.ts` validates identities/event order;
   `conversation-stream-reader.ts` handles bounded framing and idle timeout.
6. `ui/` renders composer, transcript, citations, run details, and clear confirmation.

Then follow the backend:

1. `packages/backend/src/conversation/domain/` holds state and admission policies.
2. `application/conversation-loop.ts` validates commands and coordinates
   admission, context, deadlines, model execution, and completion through ports.
3. `application/select-context.ts` and `personal-context.ts` select and serialize
   eligible history plus labeled active wording.
4. `adapters/drizzle-conversation.repository.ts` implements persistence;
   `conversation.mapper.ts` checks state-dependent stored fields.
5. `adapters/openai-conversation.model.ts` and `openai-conversation.evidence.ts`
   adapt SDK execution and observed evidence.
6. `apps/api/src/conversation/infrastructure/conversation.module.ts` composes
   dependencies; `adapters/driving/http/` owns routes, presenters, and SSE delivery.

## Verification

Run `pnpm check` for formatting, lint, strict types, unit/contract tests, and the
production build. `pnpm test:integration` applies actual migrations to disposable
PostgreSQL/pgvector and exercises database/HTTP/SDK boundaries without touching
the development database. SDK/client checks use localhost responses and deny
other provider traffic.

Local integrated acceptance covers real cookies/CSRF, the production Next.js
rewrite, persistence, early SSE, follow-ups, source inspection, reload/lost-response
recovery, read failures without replay, retry/draft lifetimes, clear/stale-tab
races, logout/expiry, empty browser storage, and history beyond model context on
phone/desktop. The separate [memory acceptance](personal-memory.md#verification)
also covers profile corrections/forgetting. Local harness artifacts are under
ignored `output/playwright/integrated/`; they are not a committed browser suite.

Synthetic notice/email/page fixtures verify roles, tool availability, evidence,
and saved outcomes. Their answer text is supplied by the stub. They do not prove
live model truthfulness, prompt-injection immunity, or provider compatibility.
Deployed Secure cookies/TLS/reverse-proxy behavior remains unverified.

## Opt-in live smoke

With valid server configuration, `pnpm smoke:conversation --live` makes paid
requests through the existing adapter without database access or owner history.
It sends three fixed synthetic turns to check a contextual follow-up and public
search evidence. Omitting `--live` or supplying invalid configuration makes no
provider request. Normal verification never invokes this command.

Each attempt uses at most 30 seconds, at most 512 output tokens per model call,
and one hosted call per Responses request, respecting smaller configured limits.
SDK default iterations, no automatic retries, and storage/tracing policy remain.
These are per-call controls, not a cumulative spending cap.

The JSON report contains UTC time, exact model/limits, normalized answers,
evidence, usage, and simple recall/evidence checks. Failures are redacted and stop
the sequence. Deterministic subprocess tests intercept provider traffic to check
opt-in/configuration, success, failure/no retry, unobserved citations, and deadline
cancellation. No live result is recorded; configured-model compatibility, actual
hosted search, and live answer quality remain unverified.
