# Design

## Context

See proposal.md for motivation and scope. The repository has Next.js presentation, NestJS API and worker entry points, Drizzle/PostgreSQL, generated OpenAPI types, and owner authentication. Conversation persistence, run lifecycle, AI configuration, SDK/API composition, protected routes, and backend streaming are implemented. The browser workspace implements history pagination, sending, draft preservation, delivery recovery, and streaming through task 3.3a. Assistant Markdown rendering and organization into `api/`, `state/`, and `ui/` are also implemented. Recorded local verification is in docs/conversation-loop.md and docs/conversation-ui-plan.md; ordinary model verification uses injected fakes or the actual SDK against localhost HTTP stubs. The worker exposes health checks only.

The behavior-preserving browser submission refactor in tasks 3.3b–3.3e is implemented. Explicit attempt retry with SSE extends the existing streaming path rather than using JSON plus polling as the normal retry experience. Backend task 2.7 is committed as 04f6c8a after its separate review stop. Browser retry and verification (tasks 3.3f–3.3g) are implemented and verified. Clear history (tasks 3.3h–3.3i) is also implemented and verified, and forms the current review checkpoint. Full interaction/auth recovery acceptance, public-web investigation, and live-model verification remain pending. Task 3.3 stays open. Existing authentication browser acceptance is documented in docs/sign-in.md.

The owner subsequently selected task 4.1 as the next focused checkpoint and explicitly requested always-available web search. Valid server AI configuration always supplies `allowedTools: ['web_search']`; there is no separate search enable flag and no temporary disablement pending 4.2. The installed SDK's `webSearchTool()` is registered only when allowed by the application port, with automatic choice and `providerData.max_tool_calls` per Responses request. There is no custom cumulative accounting. Sources/activity remain empty in this registration slice; raw hosted output remains inside the active SDK run. Stop after 4.1 for review before 4.2–4.5. See docs/conversation-loop.md for current verification; the earlier browser acceptance boxes are not completed by this scope selection.

The owner then requested committing 4.1 and starting the next slice. Commit e46b4e5 captures registration; 4.2 adds bounded observed terminal search activity and final-answer citation normalization. Optional paired source positions (`startIndex`, `endIndex`, UTF-16 with an exclusive end) persist inside the existing JSON source column, requiring only additive OpenAPI/client fields and no migration. Multiple URLs may share a citation range; conflicting overlaps, unsafe URLs, malformed shapes, and unobserved citations are not promoted. Exact marker matching supports character offsets after emoji without guessing a split surrogate boundary. Browser contracts revalidate metadata, and the renderer binds clickable citations to injected link positions rather than trusting generated links or matching URLs. Final answers show inline citations and a visible source list; provisional links remain inert. Stop after 4.2 for review before 4.3–4.5, and leave this slice uncommitted until requested.

The existing broad change puts library capture/retrieval first and excludes external-service actions. The owner prioritizes an assistant conversation runtime as the foundation for later email monitoring and approved actions, and has selected the Agents SDK from the first model integration. This focused change takes priority for that foundation; its narrower scope does not silently complete the older roadmap's recall, SSE, export, or proactivity tasks. Reconcile overlapping artifacts before archive. Update milestone documentation during implementation to distinguish completed work from each new SDK/API checkpoint.

## Goals / Non-Goals

**Goals:** provide an understandable request-to-context-to-agent-to-result path, use the SDK runner for model/tool coordination, enforce permissions outside the model, persist recoverable state, and demonstrate a real read-only investigation in a conversation.

**Non-Goals:** durable unattended execution, automatic restart/resume of paid calls, custom tool frameworks, durable token replay, hidden reasoning storage, or a general integration/approval platform. Background observation gets a separate durable worker design when email is added.

## Decisions

### 1. One Mentor agent behind the existing application port

Use the existing `packages/backend/src/conversation/` application types/use cases and repository/model ports, with Drizzle and Agents SDK adapters. Core types have no NestJS, Drizzle, or SDK imports. Keep agent definitions, SDK configuration, provider output parsing, and exception normalization inside the adapter. The `ConversationModel.complete` operation represents one bounded application attempt, even if the SDK makes several model calls. Extend its framework-independent limits/outcome types where needed; do not expose SDK run/session objects through the port. Wire the use case in `apps/api/src/conversation/`; expose frontend contracts only through generated `packages/api-client` types.

Use the TypeScript OpenAI Agents SDK (`@openai/agents`) with an explicitly configured Responses provider and one Mentor agent. The SDK runner coordinates model/tool steps inside an attempt; Mentor owns authentication, admission, tool permissions, the attempt deadline, persistence, and final publication. Start without tools at the SDK conversation checkpoint; introduce only hosted public-web search in group 4. Do not add handoffs, MCP servers, custom production function tools, a plugin registry, or an additional hand-written agent loop in this change.

The [official SDK overview](https://developers.openai.com/api/docs/guides/agents/sdk) describes this split between the runner and application-owned storage/tools. Direct Responses calls would require less setup for the first answer, but leave subsequent custom-tool coordination to Mentor. Select the SDK now for the planned expansion while keeping that expansion outside this milestone. A managed Agents API would move execution and state responsibilities to a different runtime; it is not part of this design. Future email-triggered runs can reuse the application boundary with a separate durable execution and approval design.

```text
Owner message + server-controlled available tools
    --> authenticated NestJS endpoint
    --> atomic admission + persisted turn/attempt
    --> bounded context assembly
    --> model port --> Agents SDK runner --> OpenAI Responses
                        |                    + permitted hosted web search (group 4)
                        + standard SDK execution and application abort signal
    --> validated result + observed activity + sources
    --> conditional database completion
    --> conversation UI / status recovery
```

### 2. One continuous conversation; PostgreSQL owns history and attempt state

The owner always opens the same conversation. There is no create, select, rename, thread-list, or automatic topic/day segmentation flow. Store a single conversation row with a unique owner foreign key and a monotonic history version. Resolve it automatically inside the first submission or history-clear transaction, under the existing owner lock. An initial GET returns an empty transcript with history version zero without creating records. Concurrent first-use requests therefore converge on one row.

Add a versioned migration using the existing migration journal. Proposed records:

| Record                     | Contents and constraints                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation               | UUID, unique owner foreign key, history version, timestamps; no title or user-managed lifecycle                                                             |
| Turn                       | UUID, conversation, owner-scoped submission key, original user text, ordered sequence                                                                       |
| Run attempt                | UUID, turn, attempt key, state, start/deadline/finish, model, final answer, stable error category, context-limited flag, nullable input/output token counts |
| Source/activity            | Attempt foreign key, validated citation metadata and observed public tool activity; no raw reasoning payload                                                |

Use foreign keys/cascades, unique submission/attempt keys, and owner-filtered reads. Submissions, retries, and clear-history requests carry the history version they observed; stale versions return a recoverable 409 before changing state or making a provider call. Store only a completed attempt's answer as future assistant context. Keep old failed attempts inspectable. Compare stored text directly on matching submission keys; no input fingerprint is stored.

Owner-row locking serializes admission across API processes: enforce the global owner concurrency bound and one active run per conversation atomically. Transactions end before provider calls. Admission also verifies provider configuration. Reusing a submission UUID with different text returns 409 without model work. A repeated matching key returns its original attempt state without starting another run.

Retry is explicit, only for the most recent failed/interrupted turn, with a new idempotent attempt key. It reuses the original input while applying current runtime permissions and limits. A completed turn or an older failed turn cannot be retried after newer turns exist; the UI invites a new message instead. This avoids inserting a new answer into the middle of context history.

### 3. Foreground execution with persisted recovery

Execute one bounded SDK run in the original API request; do not detach an untracked promise or introduce a queue. Its internal model/tool steps share the admitted attempt and do not create additional user turns or admission records. The initial POST returns the terminal attempt when available. Replays of an already-running key return its persisted running state without starting another runner. The client can GET the conversation and reconcile accepted work after losing the POST response.

Refresh does not resubmit or cancel. A local API process continues an admitted request after browser disconnect when possible. API shutdown, hard crash, or host failure can interrupt it; this slice promises an honest recoverable state, not guaranteed background completion. Reads and subsequent admission reconcile attempts whose persisted deadlines elapsed to interrupted. Use database timestamps for deadline decisions and an abort signal for execution. Completion is a conditional transition from running before deadline; expired, deleted, or already-terminal attempts reject late output.

Pass the same attempt abort signal through the runner to every underlying request. Use the SDK cancellation mechanism and retain application deadline and conditional-completion checks. Do not add custom request hooks or budget counters. Explicit retry starts a fresh SDK run for the latest retryable turn; it does not resume an uncertain SDK state or silently repeat a paid request. SDK resumable approvals and durable sessions are later work, not a guarantee supplied by installing the SDK.

The owner approved streaming in three review slices. Backend streaming (slice 1) and browser streaming (slice 2) are implemented; full recovery/proxy acceptance remains slice 3. Keep the compatible JSON submission route and POST `/api/v1/conversation/turns/stream`, consumed through fetch with the same JSON command, session, Origin, and CSRF protections. Do not add a GET that starts model work.

An application-owned synchronous progress observer receives committed admission and provisional text deltas; SDK and HTTP types stay in adapters. The controller decodes the HTTP request and delegates streaming to a dedicated HTTP-adapter ConversationStreamService. That service owns event mapping through shared presenters, post-header errors, and response cleanup; ConversationStream owns framing/heartbeats/buffering. Ordinary JSON routes still call the use case directly. The model adapter opts into SDK streaming only when text progress is requested. HTTP emits SSE `accepted`, `text_delta`, and `result` events with JSON data. Admission and result events carry the normal turn/attempt snapshot; accepted also carries `replayed`. Text deltas carry history version, turn ID, attempt ID, and text. Result is emitted only after conditional persistence, or is the current persisted snapshot on replay. A running replay closes without attaching to or restarting the original runner; clients recover through history reads. No token replay log or partial-answer database writes are introduced.

Validation/admission failures retain normal JSON HTTP errors before headers. Once admitted, infrastructure/stale-history failures use a redacted SSE `error` event and never a successful result. Provider failure/interruption is represented by the persisted attempt in `result`. EOF alone never proves success. Heartbeat comments keep idle streams active; no-cache/proxy-buffering headers and bounded response buffering protect delivery. A disconnected or slow reader detaches from progress without cancelling model execution or blocking persistence. The original request handler still awaits bounded execution. Ignore observer failures and late deltas after deadline, clearing, or execution settlement.

Slice 2 renders provisional text in memory, separately from persisted query history, and separates admission confirmation from streaming lifetime. The browser uses the generated POST client with streaming body parsing and browser-owned event validation. Admission and result snapshots update saved query history; provisional text is scoped by history version, turn, and attempt. Terminal saved state always wins. History polling pauses for a matching live stream, and runs only while delivery is unresolved or a running attempt has no live stream. A 15-second confirmation wait ends on admission; a 30-second lack of stream bytes detaches the reader and recovers through history. Frame parsing and provisional display have local memory bounds without changing backend/model limits. Draft acceptance, stream completion, and request cancellation have separate lifetimes so the next draft survives final output and delivery loss. Slice 3 will verify recovery, stale sessions/history, and actual Next.js proxy delivery. The first version uses history-based recovery after reload/disconnect; reconnecting to an active token stream is outside this scope. The worker remains unchanged.

### 4. Application-owned history and standard SDK behavior

The owner chose the normal SDK behavior instead of the stricter whole-run budget implementation. Use an unmodified `OpenAIResponsesModel`, one `Agent`, and `Runner`. Do not subclass request-building/fetch methods, maintain cumulative budget counters, or add a second agent loop.

For each new user turn, the application selects the current message and the newest complete user/assistant pairs from PostgreSQL that fit its serialized transcript limit, up to 100 pairs. Retain older history for browsing. This initial transcript limit excludes instructions, SDK serialization overhead, tool definitions, and subsequent intermediate items; it is not a complete request-byte guarantee. The adapter forwards the selected context unchanged. Let the SDK manage required intermediate items in memory.

Do not enable an SDK session store, OpenAI Conversations, or cross-turn response-ID chaining. PostgreSQL remains the sole durable transcript and attempt authority. Required intermediate state and hidden reasoning are not persisted. Each later user turn starts from completed application history.

Keep explicit `store: false`, disabled SDK tracing/export and sensitive logging, and disabled automatic client/SDK retries. These privacy and replay choices remain independent of the default execution behavior. `store: false` does not promise zero provider retention. Unsupported provider settings fail visibly without API or provider fallback.

Use the SDK's default iteration limit (ten in pinned SDK 0.21.0); do not override `maxTurns` or add `AI_MAX_MODEL_CALLS`. Pass `AI_MAX_OUTPUT_TOKENS` as normal SDK `maxTokens` per model call, without deducting earlier calls. Retain the existing 8 KiB message limit, 32 KiB initial transcript limit, 60-second application deadline, and one active attempt per owner. Hosted-tool settings remain a later SDK configuration concern; no production tools are registered now. There is no custom whole-run output/tool allowance or final-answer byte cap.

Use the SDK's final output, errors, and aggregate usage. Report SDK usage as provided, including its normalization of missing provider counts to zero; these are SDK-reported metrics, not independently audited totals. If no SDK usage is available, retain null rather than inventing a count. Missing usage does not block SDK continuation. Map final text and SDK errors into stable application outcomes without exposing raw exceptions or run state. The default SDK iteration-limit exception maps to `LIMIT_EXCEEDED`; cancellation maps to `INTERRUPTED`. Task 2.3 implemented persistence of available unsuccessful usage.

Pin compatible SDK/client versions and verify actual requests using a local HTTP stub. Disable tracing explicitly through global and runner configuration, remove trace processors, disable sensitive SDK logging, and keep the official client's log level off. Intercept non-stub traffic during execution, trace flushing, and shutdown. A later tracing change requires a separate privacy/disclosure decision.

### 5. Public-web investigation is the first tool

Keep tool availability in server-controlled runtime settings (`allowedTools`), independent of submitted messages. At group 4, expose the SDK's supported hosted web-search tool through Responses and let the model choose whether it is needed. Use the SDK-supported per-request tool setting when adding search, together with the SDK iteration behavior and application deadline. Do not add cumulative hosted-tool accounting. Do not force a search on every request and do not expose a per-turn investigation flag or toggle. When unavailable, omit the tool entirely. Only observed tool activity can support a claim that a search occurred; permission to search does not establish that it happened. Email access and external writes remain outside the available tool set.

The [official web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search) documents the tool, search activity, and citation annotations. Normalize structured items exposed through the SDK into bounded sources/activity; do not rely only on final answer text. Allow required internal continuation items without presenting them as user activity. Do not implement custom URL fetching, arbitrary execution, or a generic function dispatcher in this change. Register only permitted tools; reject unsupported action requests without invoking them.

Validate source URLs as HTTP(S) with no embedded credentials, enforce finite source/title/URL lengths, and render provider-backed sources separately from generated prose. Render answer text safely without raw HTML, image embeds, or automatically promoted model-generated links. Open source links with appropriate external-link protections. Citation attribution establishes provenance, not factual correctness or private-account exposure. Public pages and pasted messages are untrusted evidence and cannot change permissions. Instruction-injection fixtures test this boundary; prompt wording alone is not the permission mechanism.

### 6. Protected API contract

Add these versioned routes, with generated request/result DTOs and the existing global guard:

| Method/path                                      | Behavior                                                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/v1/assistant/status`                   | Enabled state and execution limits; no secrets                                                                                         |
| GET `/api/v1/conversation`                       | Automatically resolve the owner's single transcript; return history version and cursor-paginated turns, attempt status, activity and sources; absent state is an empty transcript      |
| POST `/api/v1/conversation/turns`                | Submit text, submission UUID, observed history version; initialize singleton state if needed, execute once or replay existing state                                                    |
| POST `/api/v1/conversation/turns/stream`         | Stream committed admission, provisional text, and the persisted result for a new message using the existing submission command                                                            |
| POST `/api/v1/conversation/turns/{turnId}/retry` | Explicit idempotent attempt for the latest retryable turn, checking observed history version                                                                                           |
| POST `/api/v1/conversation/turns/{turnId}/retry/stream` | Stream an explicit retry using the same retry command and SSE event shapes, retaining the original turn and allocating a fresh attempt key                                            |
| DELETE `/api/v1/conversation/history`            | Clear all messages and dependent content with expected history version in the JSON body; retain the singleton and increment version; reject stale repeats without deleting newer input |

No model work occurs from GET requests. GET reconciliation can terminalize expired attempts but cannot resume paid work. Mutations require existing Origin/CSRF checks. Missing/non-owned turn IDs return 404. History cursors include the history version; stale cursors return a recoverable conflict rather than mixing pre-clear and post-clear pages. Add conflict/assistant-specific errors to the existing stable envelope; distinguish busy, provider unavailable, refusal, incomplete, invalid response, and interrupted attempts without leaking raw provider errors. Do not reuse the sign-in-specific 429 message for assistant limits.

### 7. In-app presentation and privacy

The signed-in workspace lives in `apps/web/src/features/conversation/`, composed by `conversation-workspace.tsx`. Keep auth state handling and logout; protected 401 handling clears conversation queries and private drafts and cancels in-flight requests before returning to sign-in. Gate late responses by the current auth generation and persisted history version to prevent stale completions repopulating the UI after logout or history clearing. Full interaction/auth browser acceptance remains task 3.4.

The browser conversation boundary separates browser-owned Zod contracts/types,
assistant error decoding, stateless generated-client HTTP functions, request
scope, and TanStack Query integration. `api/` owns `conversation-contracts.ts`,
`conversation-errors.ts`, `conversation-api.ts`, and the SSE contracts/reader/API;
`state/` owns `conversation-scope.ts`, `conversation-queries.ts`, submission,
polling, and React hooks. `ui/` owns presentation, with response rendering under
`ui/content/`. The request scope holds only version/cancellation state
and reuses authentication's protected session scope from `auth/session-scope.ts`;
it does not import the HTTP client or TanStack Query. The query adapter accepts
that `SessionScope` contract directly; callers obtain it from `SessionState.scope()`.
The query adapter owns keys/options and cache cleanup.
Its keys include a local session generation; pagination keys also carry the
server history version. When a head refetch discovers a newer version, preserve
the query delivering that version and current-version pages while discarding
obsolete history. History transitions remove only conversation mutations, leaving
assistant status and unrelated feature state intact. Session loss still clears
all private state. Neither boundary generates submission keys or automatically
retries mutations. Tasks 3.1 and 3.2 established the client boundary and readable
workspace; sending and browser streaming are now implemented. The remaining
retry, Clear history, and full interaction requirements keep task 3.3 open.

Visual thesis: a focused monochrome workspace with a black background, white
primary controls, neutral gray surfaces/dividers, and readable typography. Owner
messages align right in white bubbles with dark text; Mentor responses align left
on dark surfaces with light text. Content plan: open directly to the
continuous transcript, with older-message pagination, composer, and expandable run
details; keep Clear history from the header in its later interaction slice.
Interaction thesis: preserve reading position and keyboard focus when prepending
history, expose details on demand, and respect reduced motion. The historical
task-3.2 checkpoint kept sending disabled; the current workspace enables Send
when status/history are ready and no attempt is running. Acceptance allows editing
the next draft while the current answer streams. Poll only for unresolved delivery
or a running attempt without a matching live stream, every two seconds in the
foreground; a healthy live stream pauses polling for that attempt.

Browser identity is centralized under `apps/web/src/brand/`: a framework-free
name/monogram/description module, shared logo and lockup components, and one CSS
token file for brand colors, semantic colors, typography, spacing, radii, and
motion. Metadata and browser copy use the same brand name. Features compose the
local shadcn primitives under `components/ui/` for buttons, text fields, labels,
alerts, and collapsible run details. Tailwind utilities map to the shared brand
tokens instead of introducing a second palette. Raw palette codes stay in the token file;
feature styles own layout. See `docs/design-system.md` for extension examples.

Use TanStack Query and generated API types, with runtime validation at frontend boundaries. A text draft stays in memory until admission is known; uncertain submissions keep their original key and reconcile through the same idempotent operation or restored history. Do not store private drafts or transcripts in browser local/session storage. Refresh restores accepted text from the backend; it does not promise recovery of an unsent in-memory draft. History pagination and the clear confirmation must retain keyboard focus, readable status announcements, and the composer within the mobile viewport. There is no thread sidebar, conversation picker, title, or New conversation button.

Documentation covers selected content, cloud processing, local history, provider-retention limits, and assistant-selected public-web search with derived queries. The owner removed the cloud-processing line and Privacy & context section beneath the composer; do not render that footer. Tool availability must not silently add unrelated owner data to search queries. No persisted acknowledgement or submission gate is required. Clear history is an explicit destructive privacy action. Under the owner lock, atomically increment history version and remove turns, attempts, and dependent sources/activity, retaining the same singleton conversation row. Abort local work where possible. Completion checks both the attempt state and captured history version, so late writes cannot restore removed content. Version checks also prevent old tabs from replaying cleared input or repeating a clear against newer messages. Refresh stale tabs to the current empty or updated history, without automatically resubmitting. Clearing cannot revoke content already sent externally.

### 7.1. Browser submission refactor before further interaction work

Tasks 3.3b–3.3e form one review checkpoint. They preserve the behavior specified by
`assistant-conversation` and `assistant-runtime`; no new product requirement or
transport contract is introduced. The existing folder organization stays in place.

Use two modules under `apps/web/src/features/conversation/state/`:

| Module | Responsibility |
| --- | --- |
| `submission-state.ts` | Pure submission state, named lifecycle transitions, failure classification, typed notices, and projection to the existing UI snapshot. No React, HTTP calls, query-cache operations, timers, or cancellation resources. |
| `conversation-submission.ts` | Coordinate HTTP progress/results, committed cache publication through the existing port, history refresh, confirmation waiting, reader cancellation, and subscriptions. Apply the pure transitions in visible effect order. |

Model unresolved delivery as a discriminated state that owns the original
`SubmitInput`, rather than synchronizing a `phase` field with an independent
nullable `pending` field. Initial send and explicit resend must remain
distinguishable. Stale-history refresh carries no pre-clear submission to replay.
Keep the current editable draft separate from delivery and provisional response
state: editing the next draft while an accepted attempt streams is valid.

Give transitions names that express acceptance, uncertain delivery, lost streaming,
observed saved completion, or scope invalidation. Eliminate boolean arguments whose
meaning depends on reading their implementation. Failure classification produces
stable categories; recovery policy still depends on whether admission was already
confirmed and whether the failure belongs to an initial send or explicit resend.
A later rejected resend cannot establish that the original submission was rejected.
Keep definitive idempotency-conflict handling and session/history invalidation
distinct from inconclusive transport or admission failures on a resend.
Typed notice codes and safe parameters determine display text; no control flow may
compare user-facing strings. Do not expose raw server/provider exception messages.

Keep runtime resources in the coordinator and name their purpose explicitly, such
as browser delivery generation and delivery abort controller. Session generation,
history version, delivery generation, and request ID protect different lifetimes;
do not merge their checks. A history read confirming acceptance must not detach a
healthy stream, while a saved terminal outcome must detach obsolete delivery.
Preserve confirmation-stop, reader-detach, publication, and refresh ordering.

Maintain `SubmissionSnapshot` and the existing hook/composer boundary where
possible by deriving the snapshot from the new state, rather than maintaining a
second mutable copy. Cache the projection so `getSnapshot()` returns the same
object between actual state changes, as required by `useSyncExternalStore`.
Saved turns remain exclusively in the query cache and PostgreSQL; provisional text
and drafts remain ephemeral. Do not add a state-machine dependency, generic effect
dispatcher, additional service hierarchy, or a new persistence layer.

The transition table and existing behavior tests are the refactor's acceptance map:

| Event or race | Preserved behavior |
| --- | --- |
| Invalid draft or known initial admission rejection | Validate before allocating a request ID; retain rejected editable text without claiming acceptance. |
| Missing confirmation or inconclusive explicit-resend failure | Retain the exact original ID, text, and history version for reconciliation. Preserve the existing definitive conflict/session/stale-history handling. Never replay automatically. |
| Acceptance through stream or saved history | Clear only the submitted draft and stop the confirmation timer. Preserve a matching live reader and any subsequently written draft. |
| Final result or saved terminal history after partial text | Saved outcome takes precedence. Completion, duplicate confirmation, late failures, and reader cleanup cannot erase the next draft or regress terminal cache state. |
| Disconnect, invalid stream, or running replay | Discard provisional text as appropriate and recover through foreground history reads/polling; a replay does not claim a live attachment. |
| Failed history refresh/check | Do not turn an unreadable history response or a page missing the request into proof of rejection. Do not resend when the recovery check fails. |
| History replacement, session loss, or obsolete delivery | Discard private state, prevent pre-clear replay, and gate late events even if transport cancellation is ignored. |

Keep the 15-second confirmation wait, two-second foreground recovery polling,
30-second stream idle timeout, and existing framing/display bounds unchanged.
Preserve the authenticated/generated-client transport, runtime validation, query
scope, cache semantics, and compatible JSON endpoint. Adding retry/Clear history
controls, removing reserved tool configuration or query-adapter functionality, and
refactoring backend execution are deferred to separate decisions after review.

Prefer this small pure-state/coordinator split over merely extracting branches
into more methods: it makes valid state combinations and transitions inspectable.
Replacing it with a new state-machine framework or a React-effect-driven request
loop would introduce another lifecycle model and is unnecessary for this slice.

### 7.2. Explicit attempt retry with SSE

Tasks 2.7 and 3.3f–3.3g form the next planned review checkpoint. The owner selected
SSE for retries so new messages and retried responses both show acceptance and
incremental text. JSON plus polling is not the primary retry path. Keep the
existing JSON retry endpoint compatible; no persistence schema change is expected.

Expose POST `/api/v1/conversation/turns/{turnId}/retry/stream` with the existing
`RetryInput` body (`requestId`, `historyVersion`) and turn ID in the path. Extend
`ConversationLoop.retry` with the same optional application progress observer as
`submit`, forwarding it to the existing execution path. Reuse the HTTP adapter's
SSE framing, event mapping, redacted errors, buffering, and cleanup for both
operations, with explicit submit/retry entry points. Keep controllers thin and
avoid duplicating the model execution or transport lifecycle. Do not route retry
through new-turn submission, attach a replay to an existing runner, or change SDK
retry, privacy, cancellation, or limit policies.

Use the existing `accepted`, `text_delta`, `result`, and `error` shapes. A retry's
accepted event follows committed admission of its new attempt. Reposting the
same retry key returns that attempt's persisted snapshot and closes without new
execution or live attachment, including when it is already completed or newer
turns exist, subject to existing history-version and execution-availability checks.
Admission failures stay JSON before SSE starts. Disconnect detaches delivery;
deadline, completion, and history-version checks still govern persistence.

The browser calls the generated streaming retry endpoint with fresh CSRF and
validates history version, requested turn ID, and `attempt.requestId` against
the retry command. The original `turn.requestId` continues to identify the first
message submission and must not be compared to the new retry key. Subsequent
events must keep the accepted turn/attempt identity. Reuse the bounded reader and
event validation, keeping operation-specific identity checks explicit.

Extend the existing pure state/coordinator split with a typed send-or-retry
operation. An unresolved send owns its original `SubmitInput`; an unresolved
retry owns the target turn ID and original `RetryInput`. Do not manufacture a
submission payload for retry or add another independent coordinator. Keep
initial delivery versus explicit replay separate from the operation kind.
Only accepting a new-message submission clears its submitted draft. Retry
acceptance, rejection, completion, replay, and duplicate confirmations preserve
the current composer draft. Existing session/history replacement still clears
private state. Saved history confirms a retry by its attempt request ID on the
target turn; an older failed attempt on the same turn cannot settle the retry.

Show `Retry response` only for the newest turn whose latest attempt is failed or
interrupted, matching the backend rule without a new error-code eligibility policy.
Disable the action while signing out, status/history is unavailable, execution is
disabled, a mutation is unresolved, or an attempt is running. Prevent duplicate
clicks before awaiting network work. The backend remains authoritative for races
with another tab. Preserve earlier attempts in run details; show progress and
provisional output on the same message. Sending stays blocked during unresolved
retry or active execution; after acceptance the next draft remains editable.
Surface missing/non-retryable turns safely, refresh history, and invite a new
message without automatically copying or submitting the old text.

Preserve the 15-second confirmation wait, 30-second idle timeout, stream bounds,
and two-second foreground recovery polling. A matching healthy live retry stream
pauses polling; unconfirmed delivery or a running attempt without a live reader
uses history recovery. An accepted running replay has no live attachment and
therefore still polls. A saved terminal retry result supersedes partial text.
Unknown delivery retains the exact retry command; only an explicit recovery
action may replay it after a successful fresh history check, using the same key.
A failed check sends nothing. Inconclusive replay rejection does not prove the
original attempt was never admitted; keep definitive conflict, stale-history,
and session-loss handling distinct. Neither connection loss nor reload starts a
fresh attempt automatically. Reload restores persisted history, not an unsent
draft or a durable live-stream subscription.

### 7.3. Explicit Clear history and uncertain deletion recovery

The owner requested a header Clear history button opening its confirmation directly, without an intermediate privacy-settings dialog.
The confirmation captures the currently observed history version; a version change
requires reviewing current history and confirming again. Explain removal of saved
messages, attempts, sources/activity, and the in-memory draft, plus the inability
to retract provider-sent content. Use shared brand tokens, existing controls, and
a native modal dialog primitive for focus containment, Escape, and focus return.
The removed composer privacy footer stays absent.

Reuse the generated-client DELETE and shared session/history query scope. The
existing pure submission-state module represents clear lifecycle and notices;
ConversationSubmission coordinates deletion, bounded confirmation, reads, and
cleanup. The dialog owns only presentation and confirmation; it closes on confirm or cancel. Progress and uncertain-outcome recovery remain in the workspace. Clearing is available
while model execution is unavailable or a send/retry is running. While deletion is
pending or uncertain, block send, retry, draft editing, duplicate clear, and send
reconciliation, including a reconciliation read started before the clear.

Only confirmed clearing or an observed history-version replacement discards the
draft, unresolved command, provisional text, timer, reader, and obsolete pages.
Keep the singleton. Read canonical history after successful deletion instead of
publishing a fabricated empty head: another tab can add messages at the new
version before that read. Late results cannot restore old content. On definitive
initial rejection preserve the draft and active delivery. A stale-version
rejection removes obsolete local content and reads current history without
repeating deletion against the newer version.

A lost, invalid, failed, or 15-second-expired clear response is uncertain, not
rollback. Offer read-only Check history and explicit Retry original clear. The
latter retains the original expected version, with no automatic DELETE retry. A
same-version read may precede an admitted DELETE and must not unlock sending or
claim failure. A rejected explicit resend cannot establish that the original
request failed. A newer-version read settles uncertainty, drops old private state,
and requires fresh confirmation for another clear. If the post-clear read fails,
keep removed content hidden and offer read-only recovery. Session replacement,
logout, and disposal invalidate clear callbacks and never replay deletion.

Stop after this checkpoint for review. Broader tasks 3.3–3.5 and investigation
remain open; this slice adds no server contract, migration, or live-model traffic.

### 8. Verification and learning checkpoints

Use injected provider fakes for normal application tests and the actual Agents SDK/Responses provider against a local HTTP stub for adapter contract tests. Intercept or deny all non-stub outbound traffic, including trace export, so tests never use real credentials or paid requests. Verify serialized `store: false`, no provider-managed conversation state, retry request counts, redaction, cancellation before/between requests, and aggregation of usage. Use synthetic test-only tools to exercise SDK iterations, default iteration-limit errors, and cancellation; never register them in production or treat their output as real investigation. Extend the existing disposable PostgreSQL integration suite; update its fixed expected migration count only if an additional migration is needed. Cover real HTTP authorization and CSRF, concurrent/idempotent admission, deadline races, history-clear races, stale-tab replays, singleton first-use concurrency, retry ordering, and limit persistence across API restart.

The completed browser submission refactor checkpoint used tasks 3.3b–3.3e.
First record the transition/behavior map and run the existing browser test baseline.
Keep assertions about visible outcomes, request counts/identity, draft lifetimes,
polling, and stale-event suppression; add tests only for meaningful missing cases.
Refactoring test setup to use the new state representation must not weaken those
assertions or substitute method-call checks for behavior. Keep all new task boxes
unchecked until their specified implementation and verification are complete.

Run `pnpm exec vitest run --config vitest.config.ts apps/web/tests` during the
refactor, then `pnpm check`. Verify generated API output has no unexplained drift.
Repeat focused synthetic desktop/phone checks for acceptance and next drafts,
lost confirmation and same-key recovery, stream disconnect and saved completion,
and session/history cleanup without duplicate writes. Record actual evidence in
docs/conversation-ui-plan.md and a short current-state reading order and concrete
send/disconnect/recovery trace in docs/conversation-loop.md. Keep historical
checkpoint evidence separate from the current entry point. Synthetic browser
verification does not complete the broader real-auth/API/database/proxy acceptance
in tasks 3.3–3.5. Database integration is not required for this browser-only
checkpoint unless implementation crosses that boundary; report what was not rerun.
No live model calls were part of that refactor. Its review boundary preceded retry,
Clear history, and search; commit only when requested.

For the next SSE retry checkpoint, verify real SDK streaming through local HTTP
stubs and actual HTTP routes with injected execution and disposable PostgreSQL.
Assert one original message, a fresh retry attempt, early text, final persistence
and available usage, same-key replay without another runner, JSON admission
errors, redacted post-header errors, disconnect isolation, and late-output
suppression after deadline or history clearing. Retain compatible JSON behavior.
Regenerate contracts with `pnpm build:services && pnpm api:generate` and inspect
the generated diff. Run `pnpm check`, `pnpm test:integration`, strict OpenSpec
validation, and `git diff --check` before marking the checkpoint verified.

Browser behavior tests and synthetic phone/desktop checks cover retry eligibility,
double clicks, healthy SSE without polling, early/final/failed text, preserved
composer drafts, attempt-key validation, acceptance through history without
detaching a healthy stream, lost confirmation with exact-key recovery, failed
checks without POST replay, disconnect and saved completion, reload, another-tab
admission races, and session/history replacement. Verify that an older terminal
attempt cannot settle the retry and late callbacks cannot regress saved results.
Record fixture versus real HTTP/database evidence and unavailable checks in
docs/conversation-ui-plan.md and docs/conversation-loop.md, with a concrete
retry/disconnect/recovery reading trace. Update AGENTS.md during implementation
to identify this checkpoint. Do not claim synthetic authentication proves full
task-3.4 acceptance. No live model calls, development-data changes, or `.env`
edits are required. Stop after the complete retry slice for review before Clear
history, broader acceptance, or investigation; commit only when requested.

Browser acceptance uses synthetic content on phone/desktop: sign in, send a message, continue with a context-dependent follow-up, refresh during work, recover a failed attempt, inspect activity/sources, clear history while work is running, verify old tabs cannot replay cleared input, and expire/logout during a request. Also return on a later date/change topic without creating or selecting a thread; overflow model context while retaining older browsable history. Include adversarial fixtures for invented action claims, unsafe links, prompt injection, refusal, incomplete responses, and unknown output shapes. Deterministic checks verify enforcement and output handling; they do not prove all generated claims are true.

A separately enabled, bounded live smoke check requires existing server credentials, explicit model/limits, and synthetic input. Record the exact model, one multi-turn discussion, and one public investigation. If configuration is absent, report the live gap; do not add secrets or claim model-quality verification from fixtures. Document the flow and each limitation in `docs/conversation-loop.md` during implementation, and make focused verified commits when requested.

## Risks / Trade-offs

- Submission state changes can regress races despite simplifying the normal path: preserve the behavior map and existing assertions, keep delivery/scope guards and effect ordering explicit, and repeat synthetic browser checks before the review checkpoint.
- Foreground requests can be lost on process failure: persisted deadlines expose interruption; explicit retry may incur another charge. Durable unattended execution is a later slice.
- SDK defaults and upgrades can change storage, tracing, retries, or execution behavior: pin tested versions and assert the actual network contract; keep SDK code behind the application port.
- Several model calls can multiply usage and context: accept the SDK default iteration limit and per-call output setting for now. There is no custom whole-run cap, and SDK usage may normalize absent counts to zero. Keep intermediate state ephemeral. Future approvals/background recovery need an explicit persisted-state design.
- Per-run limits do not cap total daily spending; daily usage limits are deferred.
- Search queries can reveal details from a pasted message: disclose assistant-selected public-web search, constrain instructions to relevant public facts, and keep search permission in runtime settings rather than a per-message toggle.
- Provider-attributed content can still be wrong: show sources and uncertainty, preserve evidence distinctions, and evaluate representative scenarios.
- Earlier roadmap artifacts overlap: this change controls the current slice; reconcile capability ownership before archive and leave unmet older tasks open.

## Migration Plan

1. SSE retry tasks 2.7 and 3.3f–3.3g are complete. Implement the approved Clear history checkpoint, tasks 3.3h–3.3i, then stop for review before broader acceptance or investigation. Earlier SDK/API, browser streaming, and browser submission refactor checkpoints are implemented. Preserve completed work and unrelated local modifications. This slice adds a streaming retry API contract and browser controls, reuses existing execution/persistence rules, and is expected to require no migration.
2. Apply new migrations only to the disposable integration database during verification. Existing development data is migrated through the normal documented command, without schema push or volume deletion.
3. Earlier checkpoints removed the stricter budget policy and its model-call setting; obsolete extra environment keys are ignored. Preserve the standard SDK configuration, explicit tracing/storage/retry policies, and existing `.env`. AI execution becomes ready automatically with valid server model/key/finite-limit configuration; missing or invalid settings preserve read-only history. Cloud-processing documentation stays in place without a composer disclosure footer, following the owner's revised UI decision.
4. Roll back to the prior application version with AI disabled; keep additive tables for a forward fix rather than destructively rolling back private history.

## Open Questions

- Which account-available model and tighter personal limits should be configured for the optional live smoke check? No default model, credentials, or paid execution is assumed by this plan.
