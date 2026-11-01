# Design

## Context

See proposal.md for motivation and scope. The current repository has Next.js presentation, NestJS API and worker entry points, Drizzle/PostgreSQL, generated OpenAPI types, and owner authentication. Conversation persistence and run lifecycle (group 1), architecture follow-ups, and server-only AI configuration (task 2.1) are implemented with local verification. The application currently uses an injected fake model in tests; the SDK adapter has local HTTP-stub verification; conversation HTTP composition, UI, and public-web investigation remain later checkpoints. The worker exposes health checks only. Existing authentication browser acceptance is documented in docs/sign-in.md.

The existing broad change puts library capture/retrieval first and excludes external-service actions. The owner prioritizes an assistant conversation runtime as the foundation for later email monitoring and approved actions, and has selected the Agents SDK from the first model integration. This focused change takes priority for that foundation; its narrower scope does not silently complete the older roadmap's recall, SSE, export, or proactivity tasks. Reconcile overlapping artifacts before archive. Update milestone documentation during implementation to distinguish completed work from each new SDK/API checkpoint.

## Goals / Non-Goals

**Goals:** provide an understandable request-to-context-to-agent-to-result path, use the SDK runner for model/tool coordination, enforce permissions outside the model, persist recoverable state, and demonstrate a real read-only investigation in a conversation.

**Non-Goals:** durable unattended execution, automatic restart/resume of paid calls, custom tool frameworks, streaming partial answers, hidden reasoning storage, or a general integration/approval platform. Background observation gets a separate durable worker design when email is added.

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

Polling the conversation while an attempt is running is enough for this checkpoint. No SSE/WebSocket or partial answer stream is needed. The UI says Working until an observed terminal result exists; it does not invent a sequence of investigation steps. The worker remains unchanged.

### 4. Application-owned history and standard SDK behavior

The owner chose the normal SDK behavior instead of the stricter whole-run budget implementation. Use an unmodified `OpenAIResponsesModel`, one `Agent`, and `Runner`. Do not subclass request-building/fetch methods, maintain cumulative budget counters, or add a second agent loop.

For each new user turn, the application selects the current message and the newest complete user/assistant pairs from PostgreSQL that fit its serialized transcript limit, up to 100 pairs. Retain older history for browsing. This initial transcript limit excludes instructions, SDK serialization overhead, tool definitions, and subsequent intermediate items; it is not a complete request-byte guarantee. The adapter forwards the selected context unchanged. Let the SDK manage required intermediate items in memory.

Do not enable an SDK session store, OpenAI Conversations, or cross-turn response-ID chaining. PostgreSQL remains the sole durable transcript and attempt authority. Required intermediate state and hidden reasoning are not persisted. Each later user turn starts from completed application history.

Keep explicit `store: false`, disabled SDK tracing/export and sensitive logging, and disabled automatic client/SDK retries. These privacy and replay choices remain independent of the default execution behavior. `store: false` does not promise zero provider retention. Unsupported provider settings fail visibly without API or provider fallback.

Use the SDK's default iteration limit (ten in pinned SDK 0.21.0); do not override `maxTurns` or add `AI_MAX_MODEL_CALLS`. Pass `AI_MAX_OUTPUT_TOKENS` as normal SDK `maxTokens` per model call, without deducting earlier calls. Retain the existing 8 KiB message limit, 32 KiB initial transcript limit, 60-second application deadline, and one active attempt per owner. Hosted-tool settings remain a later SDK configuration concern; no production tools are registered now. There is no custom whole-run output/tool allowance or final-answer byte cap.

Use the SDK's final output, errors, and aggregate usage. Report SDK usage as provided, including its normalization of missing provider counts to zero; these are SDK-reported metrics, not independently audited totals. If no SDK usage is available, retain null rather than inventing a count. Missing usage does not block SDK continuation. Map final text and SDK errors into stable application outcomes without exposing raw exceptions or run state. The default SDK iteration-limit exception maps to `LIMIT_EXCEEDED`; cancellation maps to `INTERRUPTED`. Persisting available unsuccessful usage remains task 2.3.

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
| POST `/api/v1/conversation/turns/{turnId}/retry` | Explicit idempotent attempt for the latest retryable turn, checking observed history version                                                                                           |
| DELETE `/api/v1/conversation/history`            | Clear all messages and dependent content with expected history version in the JSON body; retain the singleton and increment version; reject stale repeats without deleting newer input |

No model work occurs from GET requests. GET reconciliation can terminalize expired attempts but cannot resume paid work. Mutations require existing Origin/CSRF checks. Missing/non-owned turn IDs return 404. History cursors include the history version; stale cursors return a recoverable conflict rather than mixing pre-clear and post-clear pages. Add conflict/assistant-specific errors to the existing stable envelope; distinguish busy, provider unavailable, refusal, incomplete, invalid response, and interrupted attempts without leaking raw provider errors. Do not reuse the sign-in-specific 429 message for assistant limits.

### 7. In-app presentation and privacy

Replace the signed-in placeholder with `apps/web/src/features/conversation/`. Keep auth state handling and logout; generalize protected-request handling so 401 clears conversation queries and private drafts and cancels in-flight requests before returning to sign-in. Gate late responses by the current auth generation and persisted history version to prevent stale completions repopulating the UI after logout or history clearing.

The browser conversation boundary separates browser-owned Zod contracts/types,
assistant error decoding, stateless generated-client HTTP functions, request
scope, and TanStack Query integration into `conversation-contracts.ts`,
`conversation-errors.ts`, `conversation-api.ts`, `conversation-scope.ts`, and
`conversation-queries.ts`. The request scope holds only version/cancellation state
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
retries mutations. This separation is part of task 3.1; transcript/composer UI
and resilient interaction wiring remain later checkpoints.

Visual thesis: a calm writing workspace using the existing warm background, green accent, and readable typography. Content plan: open directly to the continuous transcript, with older-message pagination, composer, and expandable run/source detail; keep Clear history in privacy settings rather than the primary conversation flow. Interaction thesis: clear pending-to-result transitions and responsive navigation with reduced-motion support; avoid ornamental dashboards or fake tool activity.

Use TanStack Query and generated API types, with runtime validation at frontend boundaries. A text draft stays in memory until admission is known; uncertain submissions keep their original key and reconcile through the same idempotent operation or restored history. Do not store private drafts or transcripts in browser local/session storage. Refresh restores accepted text from the backend; it does not promise recovery of an unsent in-memory draft. History pagination and privacy settings must retain keyboard focus, readable status announcements, and the composer within the mobile viewport. There is no thread sidebar, conversation picker, title, or New conversation button.

An informational notice covers selected content, cloud processing, local history, and provider-retention limits. The notice includes assistant-selected public-web search and derived queries; tool availability must not silently add unrelated owner data to search queries. No persisted acknowledgement or submission gate is required. Clear history is an explicit destructive privacy action. Under the owner lock, atomically increment history version and remove turns, attempts, and dependent sources/activity, retaining the same singleton conversation row. Abort local work where possible. Completion checks both the attempt state and captured history version, so late writes cannot restore removed content. Version checks also prevent old tabs from replaying cleared input or repeating a clear against newer messages. Refresh stale tabs to the current empty or updated history, without automatically resubmitting. Clearing cannot revoke content already sent externally.

### 8. Verification and learning checkpoints

Use injected provider fakes for normal application tests and the actual Agents SDK/Responses provider against a local HTTP stub for adapter contract tests. Intercept or deny all non-stub outbound traffic, including trace export, so tests never use real credentials or paid requests. Verify serialized `store: false`, no provider-managed conversation state, retry request counts, redaction, cancellation before/between requests, and aggregation of usage. Use synthetic test-only tools to exercise SDK iterations, default iteration-limit errors, and cancellation; never register them in production or treat their output as real investigation. Extend the existing disposable PostgreSQL integration suite; update its fixed expected migration count only if an additional migration is needed. Cover real HTTP authorization and CSRF, concurrent/idempotent admission, deadline races, history-clear races, stale-tab replays, singleton first-use concurrency, retry ordering, and limit persistence across API restart.

The next review checkpoint is the simplified SDK conversation adapter and its contract tests (tasks 2.2a–2.2c). Prove compatibility through the actual SDK before proceeding to use-case composition or protected routes. This checkpoint does not expose live submission or add public-web tools. Stop for review after relevant checks; commit when requested. Preserve the completed group 1 and task 2.1 checkboxes, and leave all new SDK work unchecked until its specified validation is performed.

Browser acceptance uses synthetic content on phone/desktop: sign in, send a message, continue with a context-dependent follow-up, refresh during work, recover a failed attempt, inspect activity/sources, clear history while work is running, verify old tabs cannot replay cleared input, and expire/logout during a request. Also return on a later date/change topic without creating or selecting a thread; overflow model context while retaining older browsable history. Include adversarial fixtures for invented action claims, unsafe links, prompt injection, refusal, incomplete responses, and unknown output shapes. Deterministic checks verify enforcement and output handling; they do not prove all generated claims are true.

A separately enabled, bounded live smoke check requires existing server credentials, explicit model/limits, and synthetic input. Record the exact model, one multi-turn discussion, and one public investigation. If configuration is absent, report the live gap; do not add secrets or claim model-quality verification from fixtures. Document the flow and each limitation in `docs/conversation-loop.md` during implementation, and make focused verified commits when requested.

## Risks / Trade-offs

- Foreground requests can be lost on process failure: persisted deadlines expose interruption; explicit retry may incur another charge. Durable unattended execution is a later slice.
- SDK defaults and upgrades can change storage, tracing, retries, or execution behavior: pin tested versions and assert the actual network contract; keep SDK code behind the application port.
- Several model calls can multiply usage and context: accept the SDK default iteration limit and per-call output setting for now. There is no custom whole-run cap, and SDK usage may normalize absent counts to zero. Keep intermediate state ephemeral. Future approvals/background recovery need an explicit persisted-state design.
- Per-run limits do not cap total daily spending; daily usage limits are deferred.
- Search queries can reveal details from a pasted message: disclose assistant-selected public-web search, constrain instructions to relevant public facts, and keep search permission in runtime settings rather than a per-message toggle.
- Provider-attributed content can still be wrong: show sources and uncertainty, preserve evidence distinctions, and evaluate representative scenarios.
- Earlier roadmap artifacts overlap: this change controls the current slice; reconcile capability ownership before archive and leave unmet older tasks open.

## Migration Plan

1. Implement tasks 2.2a–2.2c as the next SDK-only review checkpoint, then proceed separately through application/API, UI, and investigation checkpoints. Preserve completed work and update milestone documentation without changing unrelated owner-auth code or the existing local generated `next-env.d.ts` modification.
2. Apply new migrations only to the disposable integration database during verification. Existing development data is migrated through the normal documented command, without schema push or volume deletion.
3. Remove the stricter budget policy and its model-call setting without editing an existing `.env`; obsolete extra environment keys are ignored. Use the standard SDK configuration. Construct the explicit Responses provider and runner with tracing/storage/retry policies before exposing them. AI execution becomes ready automatically with valid server model/key/finite-limit configuration; missing or invalid settings preserve read-only history. The UI disclosure must be in place before live model submission is exposed.
4. Roll back to the prior application version with AI disabled; keep additive tables for a forward fix rather than destructively rolling back private history.

## Open Questions

- Which account-available model and tighter personal limits should be configured for the optional live smoke check? No default model, credentials, or paid execution is assumed by this plan.
