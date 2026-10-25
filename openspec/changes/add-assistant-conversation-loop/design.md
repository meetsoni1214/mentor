# Design

## Context

See proposal.md for motivation and scope. The current repository has Next.js presentation, NestJS API and worker entry points, Drizzle/PostgreSQL, generated OpenAPI types, and owner authentication. Conversation persistence and run lifecycle (group 1), architecture follow-ups, and server-only AI configuration (task 2.1) are implemented with local verification. The application currently uses an injected fake model in tests; the real provider adapter, conversation HTTP composition, UI, and public-web investigation remain unimplemented. The worker exposes health checks only. Existing authentication browser acceptance is documented in docs/sign-in.md.

The existing broad change puts library capture/retrieval first and excludes external-service actions. The owner prioritizes an assistant conversation runtime as the foundation for later email monitoring and approved actions, and has selected the Agents SDK from the first model integration. This focused change takes priority for that foundation; its narrower scope does not silently complete the older roadmap's recall, SSE, export, or proactivity tasks. Reconcile overlapping artifacts before archive. Update milestone documentation during implementation to distinguish completed work from each new SDK/API checkpoint.

## Goals / Non-Goals

**Goals:** provide an understandable request-to-context-to-agent-to-result path, use the SDK runner for model/tool coordination, enforce permissions outside the model, persist recoverable state, and demonstrate a real read-only investigation in a conversation.

**Non-Goals:** durable unattended execution, automatic restart/resume of paid calls, custom tool frameworks, streaming partial answers, hidden reasoning storage, or a general integration/approval platform. Background observation gets a separate durable worker design when email is added.

## Decisions

### 1. One Mentor agent behind the existing application port

Use the existing `packages/backend/src/conversation/` application types/use cases and repository/model ports, with Drizzle and Agents SDK adapters. Core types have no NestJS, Drizzle, or SDK imports. Keep agent definitions, SDK configuration, provider output parsing, and exception normalization inside the adapter. The `ConversationModel.complete` operation represents one bounded application attempt, even if the SDK makes several model calls. Extend its framework-independent limits/outcome types where needed; do not expose SDK run/session objects through the port. Wire the use case in `apps/api/src/conversation/`; expose frontend contracts only through generated `packages/api-client` types.

Use the TypeScript OpenAI Agents SDK (`@openai/agents`) with an explicitly configured Responses provider and one Mentor agent. The SDK runner coordinates model/tool steps inside an attempt; Mentor owns authentication, admission, tool permissions, budgets, persistence, and final publication. Start without tools at the SDK conversation checkpoint; introduce only hosted public-web search in group 4. Do not add handoffs, MCP servers, custom production function tools, a plugin registry, or an additional hand-written agent loop in this change.

The [official SDK overview](https://developers.openai.com/api/docs/guides/agents/sdk) describes this split between the runner and application-owned storage/tools. Direct Responses calls would require less setup for the first answer, but leave subsequent custom-tool coordination to Mentor. Select the SDK now for the planned expansion while keeping that expansion outside this milestone. A managed Agents API would move execution and state responsibilities to a different runtime; it is not part of this design. Future email-triggered runs can reuse the application boundary with a separate durable execution and approval design.

```text
Owner message + server-controlled available tools
    --> authenticated NestJS endpoint
    --> atomic admission + persisted turn/attempt
    --> bounded context assembly
    --> model port --> Agents SDK runner --> OpenAI Responses
                        |                    + permitted hosted web search (group 4)
                        + one shared run budget and abort signal
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

Pass the same attempt abort signal through the runner to every underlying request. Check cancellation and remaining budgets before each model/tool step, and start no new step after cancellation. Explicit retry starts a fresh SDK run for the latest retryable turn; it does not resume an uncertain SDK state or silently repeat a paid request. SDK resumable approvals and durable sessions are later work, not a guarantee supplied by installing the SDK.

Polling the conversation while an attempt is running is enough for this checkpoint. No SSE/WebSocket or partial answer stream is needed. The UI says Working until an observed terminal result exists; it does not invent a sequence of investigation steps. The worker remains unchanged.

### 4. Application-owned history and bounded SDK context

Pass application instructions, the current message, and the newest complete user/assistant pairs from the continuous conversation that fit a finite serialized UTF-8 input budget. Bound the history query as well as the outgoing payload. Preserve older turns for paginated browsing even when omitted from a model request; do not reset the conversation when its context grows. Never include another owner's data, failed partial output, hidden reasoning, credentials, or unrequested profile guesses. Keep role boundaries explicit: pasted emails and prior assistant output do not become application instructions.

Choose application-managed input for every new user turn. Do not enable an additional SDK session store, OpenAI Conversations, or cross-turn response-ID chaining. PostgreSQL remains the sole durable transcript and attempt authority; automatic SDK transcript writes would bypass conditional completion and history-version checks. The [SDK continuation guide](https://developers.openai.com/api/docs/guides/agents/running-agents) describes the alternative strategies and warns against duplicating local replay with server-managed state.

Within the active run, let the SDK preserve required ordered response, tool, and reasoning-continuation items in memory. Do not strip required items to force a further model call; stop with a stable limit/invalid-response outcome if safe continuation cannot fit the input budget. A later user turn starts from the bounded completed user/assistant pairs in PostgreSQL, not replay of the prior raw SDK run. Required intermediate items and hidden reasoning are not durable transcript or activity records.

Set `store: false` on every underlying Responses request, including later runner iterations. The [official conversation-state guide](https://developers.openai.com/api/docs/guides/conversation-state) documents response storage controls. This design does not equate `store: false` with zero provider retention. No raw SDK/provider response is persisted. Context truncation is explicit and visible without asking the owner to manage sessions, create another conversation, or start over. Long-term recall and automatic summarization remain later work; retained history alone does not guarantee recall of older facts.

Enable execution automatically when a server-only `OPENAI_API_KEY`, explicit `OPENAI_CHAT_MODEL`, and finite limits are valid. No separate enable flag is required. Validate configuration with redacted Zod diagnostics; invalid AI settings disable execution without preventing history reads or clearing. Preserve completed task 2.1 as evidence for its existing configuration contract; add SDK-specific limits in new unchecked tasks.

Finite starting settings are 8 KiB user text, 32 KiB serialized model input per request, 2,048 total output tokens per application run, a 60-second deadline for the entire run, one owner-wide active run, at most three model calls per run, and at most two hosted tool calls per run when available. Add `AI_MAX_MODEL_CALLS` with a default of three and explicit finite validation. These are conservative defaults, not model-pricing assertions or a daily attempt cap.

Enforce these policies through the actual SDK provider/model boundary, without reimplementing the runner:

- Count each underlying model request against the remaining model-call allowance, and set the SDK runner's iteration limit as an additional guard. An iteration cap alone does not bound hosted tool calls or output.
- Reserve instruction/runtime overhead when selecting initial history and check the complete serialized model input, including required intermediate items, before every request. Drop only eligible older complete transcript pairs during initial selection; do not silently drop the current message or required in-run items. Bound initial database reads as well.
- Pass only the remaining output-token allowance on each request and deduct observed output usage before another call. Bound total returned answer text as well. If usage needed to establish a safe remaining allowance is missing or malformed, do not start another call or treat unknown usage as zero.
- Pass only the remaining hosted-tool allowance, using supported provider limits and observed structured tool activity to account for it across calls. Omit tools when none remain. SDK model iterations and provider-hosted search actions are separate counters.
- Propagate the same deadline/cancellation signal and disable automatic retries in the underlying OpenAI client and any SDK/provider retry path. Internal planned model/tool steps are distinct from retrying a failed request.

Pin a compatible Agents SDK/OpenAI client combination during implementation and test its actual serialized requests and request counts. Verify support for storage, retry, tracing, cancellation, and budget controls before API composition. Unsupported model/tool settings or unenforceable limits fail visibly; do not silently switch APIs, providers, or policies. Application-run exhaustion maps to a stable limit-exceeded failure; deadline expiry maps to interrupted. Neither publishes partial output as a completed answer.

Aggregate actual input/output usage across the run's calls and preserve known usage on unsuccessful attempts where available. Extend the framework-independent outcome and persistence mapping to carry this metadata without raw SDK objects. Totals remain nullable when any required usage is unknown; do not report a partial sum as a complete total. No additional durable SDK-state store is required. These controls bound configured execution, not total daily spending or an exact monetary budget.

Disable SDK tracing and automatic trace export explicitly at runtime construction and per-run configuration, using the pinned SDK's supported controls. Do not rely on `store: false` to disable tracing. The [SDK observability guide](https://developers.openai.com/api/docs/guides/agents/integrations-observability) documents tracing as enabled by default. Keep local observability limited to redacted operational metadata and the existing validated usage/activity/source records; do not export prompts, outputs, tool payloads, secrets, or hidden reasoning. Test with network interception that ordinary runs and shutdown do not send trace/export traffic. Enabling external tracing later requires a separate privacy/disclosure decision.

### 5. Public-web investigation is the first tool

Keep tool availability in server-controlled runtime settings (`allowedTools`), independent of submitted messages. At group 4, expose the SDK's supported hosted web-search tool through Responses and let the model choose whether it is needed. Enforce the shared run tool allowance through the remaining provider `max_tool_calls`, model-call/output limits, and deadline. Do not force a search on every request and do not expose a per-turn investigation flag or toggle. When unavailable, omit the tool entirely. Only observed tool activity can support a claim that a search occurred; permission to search does not establish that it happened. Email access and external writes remain outside the available tool set.

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

Visual thesis: a calm writing workspace using the existing warm background, green accent, and readable typography. Content plan: open directly to the continuous transcript, with older-message pagination, composer, and expandable run/source detail; keep Clear history in privacy settings rather than the primary conversation flow. Interaction thesis: clear pending-to-result transitions and responsive navigation with reduced-motion support; avoid ornamental dashboards or fake tool activity.

Use TanStack Query and generated API types, with runtime validation at frontend boundaries. A text draft stays in memory until admission is known; uncertain submissions keep their original key and reconcile through the same idempotent operation or restored history. Do not store private drafts or transcripts in browser local/session storage. Refresh restores accepted text from the backend; it does not promise recovery of an unsent in-memory draft. History pagination and privacy settings must retain keyboard focus, readable status announcements, and the composer within the mobile viewport. There is no thread sidebar, conversation picker, title, or New conversation button.

An informational notice covers selected content, cloud processing, local history, and provider-retention limits. The notice includes assistant-selected public-web search and derived queries; tool availability must not silently add unrelated owner data to search queries. No persisted acknowledgement or submission gate is required. Clear history is an explicit destructive privacy action. Under the owner lock, atomically increment history version and remove turns, attempts, and dependent sources/activity, retaining the same singleton conversation row. Abort local work where possible. Completion checks both the attempt state and captured history version, so late writes cannot restore removed content. Version checks also prevent old tabs from replaying cleared input or repeating a clear against newer messages. Refresh stale tabs to the current empty or updated history, without automatically resubmitting. Clearing cannot revoke content already sent externally.

### 8. Verification and learning checkpoints

Use injected provider fakes for normal application tests and the actual Agents SDK/Responses provider against a local HTTP stub for adapter contract tests. Intercept or deny all non-stub outbound traffic, including trace export, so tests never use real credentials or paid requests. Verify serialized `store: false`, no provider-managed conversation state, retry request counts, redaction, cancellation before/between requests, and aggregation of usage. Use synthetic test-only tools if needed to exercise several SDK iterations and budget exhaustion; never register them in production or treat their output as real investigation. Extend the existing disposable PostgreSQL integration suite; update its fixed expected migration count only if an additional migration is needed. Cover real HTTP authorization and CSRF, concurrent/idempotent admission, deadline races, history-clear races, stale-tab replays, singleton first-use concurrency, retry ordering, and limit persistence across API restart.

The next review checkpoint is the SDK conversation adapter and its policy/contract tests (tasks 2.2a–2.2c). Prove compatibility through the actual SDK before proceeding to use-case composition or protected routes. This checkpoint does not expose live submission or add public-web tools. Stop for review after relevant checks; commit when requested. Preserve the completed group 1 and task 2.1 checkboxes, and leave all new SDK work unchecked until its specified validation is performed.

Browser acceptance uses synthetic content on phone/desktop: sign in, send a message, continue with a context-dependent follow-up, refresh during work, recover a failed attempt, inspect activity/sources, clear history while work is running, verify old tabs cannot replay cleared input, and expire/logout during a request. Also return on a later date/change topic without creating or selecting a thread; overflow model context while retaining older browsable history. Include adversarial fixtures for invented action claims, unsafe links, prompt injection, refusal, incomplete responses, and unknown output shapes. Deterministic checks verify enforcement and output handling; they do not prove all generated claims are true.

A separately enabled, bounded live smoke check requires existing server credentials, explicit model/limits, and synthetic input. Record the exact model, one multi-turn discussion, and one public investigation. If configuration is absent, report the live gap; do not add secrets or claim model-quality verification from fixtures. Document the flow and each limitation in `docs/conversation-loop.md` during implementation, and make focused verified commits when requested.

## Risks / Trade-offs

- Foreground requests can be lost on process failure: persisted deadlines expose interruption; explicit retry may incur another charge. Durable unattended execution is a later slice.
- SDK defaults and upgrades can change storage, tracing, retries, or execution behavior: pin tested versions and assert the actual network contract; keep SDK code behind the application port.
- Several model calls can multiply usage and context: share budgets across the entire run, stop on unknown allowance, and keep intermediate SDK state ephemeral. Future approvals/background recovery need an explicit persisted-state design.
- Per-run limits do not cap total daily spending; daily usage limits are deferred.
- Search queries can reveal details from a pasted message: disclose assistant-selected public-web search, constrain instructions to relevant public facts, and keep search permission in runtime settings rather than a per-message toggle.
- Provider-attributed content can still be wrong: show sources and uncertainty, preserve evidence distinctions, and evaluate representative scenarios.
- Earlier roadmap artifacts overlap: this change controls the current slice; reconcile capability ownership before archive and leave unmet older tasks open.

## Migration Plan

1. Implement tasks 2.2a–2.2c as the next SDK-only review checkpoint, then proceed separately through application/API, UI, and investigation checkpoints. Preserve completed work and update milestone documentation without changing unrelated owner-auth code or the existing local generated `next-env.d.ts` modification.
2. Apply new migrations only to the disposable integration database during verification. Existing development data is migrated through the normal documented command, without schema push or volume deletion.
3. Add the validated model-call allowance and whole-run budget semantics through the normal configuration path without overwriting `.env`. Construct the explicit Responses provider and runner with tracing/storage/retry policies before exposing them. AI execution becomes ready automatically with valid server model/key/finite-limit configuration; missing or invalid settings preserve read-only history. The UI disclosure must be in place before live model submission is exposed.
4. Roll back to the prior application version with AI disabled; keep additive tables for a forward fix rather than destructively rolling back private history.

## Open Questions

- Which account-available model and tighter personal limits should be configured for the optional live smoke check? No default model, credentials, or paid execution is assumed by this plan.
