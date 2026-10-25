# Design

## Context

See proposal.md for motivation and scope. The current repository has Next.js presentation, NestJS API and worker entry points, Drizzle/PostgreSQL, generated OpenAPI types, and owner authentication. Commit `11b2cd5` records authentication verification; no conversation module or model adapter exists. The worker currently exposes health checks only. Inspection of tests found real-database and HTTP authentication coverage, with browser acceptance documented separately in docs/sign-in.md.

The existing broad change puts library capture/retrieval first and excludes external-service actions. The owner's current instruction prioritizes an assistant conversation runtime as the foundation for later email monitoring and approved actions. This focused change takes priority for that foundation; its narrower scope does not silently complete the older roadmap's recall, SSE, export, or proactivity tasks. Reconcile overlapping artifacts before archive. The checked-in AGENTS.md milestone text will need a focused update during implementation to distinguish completed auth from this approved slice.

## Goals / Non-Goals

**Goals:** provide an understandable request-to-context-to-model-to-result path, enforce permissions outside the model, persist recoverable state, and demonstrate a real read-only investigation in a conversation.

**Non-Goals:** durable unattended execution, automatic restart/resume of paid calls, custom tool frameworks, streaming partial answers, hidden reasoning storage, or a general integration/approval platform. Background observation gets a separate durable worker design when email is added.

## Decisions

### 1. One backend use case with explicit ports

Add `packages/backend/src/conversation/` with application types/use cases and repository/model ports, plus Drizzle and OpenAI adapters. Core types have no NestJS, Drizzle, or SDK imports. Keep provider-specific output parsing inside its adapter. Wire the use case in `apps/api/src/conversation/`; expose frontend contracts only through generated `packages/api-client` types.

Use the official OpenAI Node SDK with the Responses API rather than an agent framework. One provider request can perform bounded built-in web investigation. The useful boundary is the assistant request/result port, not a generic graph, multi-agent coordinator, or plugin registry. Future email-triggered runs can reuse the port while adding their own durable execution policy.

```text
Owner message + explicit investigation setting
    --> authenticated NestJS endpoint
    --> atomic admission + persisted turn/attempt
    --> bounded context assembly
    --> model port --> OpenAI Responses + optional public-web search
    --> validated result + observed activity + sources
    --> conditional database completion
    --> conversation UI / status recovery
```

### 2. PostgreSQL owns history and attempt state

Add a versioned migration using the existing migration journal. Proposed records:

| Record                     | Contents and constraints                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Conversation               | UUID, owner foreign key, timestamps; deterministic preview from first message, no paid title generation                              |
| Turn                       | UUID, conversation, owner-scoped submission key, input digest, original user text, investigation flag, ordered sequence              |
| Run attempt                | UUID, turn, attempt key, state, start/deadline/finish, model, final answer, stable error category, context-limited flag, known usage |
| Source/activity            | Attempt foreign key, validated citation metadata and observed public tool activity; no raw reasoning payload                         |
| Daily admission            | Owner plus UTC date, atomically reserved attempt count; survives API restarts                                                        |
| Disclosure acknowledgement | Owner and disclosure version, with acknowledgement timestamp                                                                         |

Use foreign keys/cascades, unique submission/attempt keys, and owner-filtered reads. Store only a completed attempt's answer as future assistant context. Keep old failed attempts inspectable. Do not log request input digests as a substitute for redaction.

Owner-row locking serializes admission across API processes: enforce the global owner concurrency bound, daily allowance, and one active run per conversation atomically. Transactions end before provider calls. Admission also verifies current acknowledgement and provider configuration. UUID/digest conflicts return 409 without model work. A repeated matching key returns its original attempt state without reserving another admission, even when today's allowance is exhausted.

Retry is explicit, only for the most recent failed/interrupted turn, with a new idempotent attempt key. It reuses the original input and investigation choice. A completed turn or an older failed turn cannot be retried after newer turns exist; the UI invites a new message instead. This avoids inserting a new answer into the middle of context history.

### 3. Foreground execution with persisted recovery

Execute the bounded provider call in the original API request; do not detach an untracked promise or introduce a queue. The initial POST returns the terminal attempt when available. Replays of an already-running key return its persisted running state. The client can GET the conversation and reconcile accepted work after losing the POST response.

Refresh does not resubmit or cancel. A local API process continues an admitted request after browser disconnect when possible. API shutdown, hard crash, or host failure can interrupt it; this slice promises an honest recoverable state, not guaranteed background completion. Reads and subsequent admission reconcile attempts whose persisted deadlines elapsed to interrupted. Use database timestamps for deadline decisions and an abort signal for execution. Completion is a conditional transition from running before deadline; expired, deleted, or already-terminal attempts reject late output.

Polling the conversation while an attempt is running is enough for this checkpoint. No SSE/WebSocket or partial answer stream is needed. The UI says Working until an observed terminal result exists; it does not invent a sequence of investigation steps. The worker remains unchanged.

### 4. Bounded explicit model context

Pass application instructions, the current message, and the newest complete user/assistant pairs that fit a finite serialized UTF-8 input budget. Bound the history query as well as the outgoing payload. Never include other conversations, failed partial output, hidden reasoning, credentials, or unrequested profile guesses. Keep role boundaries explicit: pasted emails and prior assistant output do not become application instructions.

Use `store: false`; send needed context explicitly rather than provider Conversations or `previous_response_id`. The [official conversation-state guide](https://developers.openai.com/api/docs/guides/conversation-state) documents manual history and response storage controls. This design does not equate `store: false` with zero provider retention. No raw provider response is persisted. Context truncation is explicit and visible; no automatic summarization or cross-thread memory yet.

Require `AI_ENABLED=true`, a server-only `OPENAI_API_KEY`, and explicit `OPENAI_CHAT_MODEL` to enable execution. Validate configuration with the existing redacted Zod environment pattern. Proposed finite defaults: 8 KiB user text, 32 KiB total serialized input, 2,048 output tokens, 60-second deadline, one owner-wide active run, 20 admitted attempts per UTC day, and at most two built-in tool calls per run. These are conservative starting settings, not assertions about model pricing. Reject incompatible limits clearly. The adapter must verify the pinned SDK supports the required request fields; an incompatible model/tool configuration fails visibly with no silent fallback.

Daily attempt reservations are conservative: failed/uncertain provider calls keep their admission, and SDK retries are disabled. Persist actual returned usage when available. The local controls bound calls and output; they do not implement the older roadmap's shared daily token reservations or promise an exact monetary ceiling. Show remaining admissions and the UTC reset time. A later shared API/worker usage design is required before unattended work.

### 5. Public-web investigation is the first tool

Default each new turn to investigation disabled. Enabling the visible Investigate public sources control is explicit permission for that turn to use the provider's built-in `web_search`; it is not permission to read email or mutate accounts. Give the model only this read-only tool, with a finite `max_tool_calls`, output limit, and deadline. Requests without the selection contain no tools. Investigation-enabled requests require an actual search, or end with an honest unavailable/incomplete result; they cannot silently claim verification from model knowledge.

The [official web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search) documents the tool, search activity, and citation annotations. Use those structured output items to normalize sources/activity. Do not implement custom URL fetching, arbitrary execution, or a generic function dispatcher in this change. The adapter rejects unexpected output types needed for unsupported capabilities instead of dispatching them.

Validate source URLs as HTTP(S) with no embedded credentials, enforce finite source/title/URL lengths, and render provider-backed sources separately from generated prose. Render answer text safely without raw HTML, image embeds, or automatically promoted model-generated links. Open source links with appropriate external-link protections. Citation attribution establishes provenance, not factual correctness or private-account exposure. Public pages and pasted messages are untrusted evidence and cannot change permissions. Instruction-injection fixtures test this boundary; prompt wording alone is not the permission mechanism.

### 6. Protected API contract

Add these versioned routes, with generated request/result DTOs and the existing global guard:

| Method/path                                            | Behavior                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| GET `/api/v1/assistant/status`                         | Enabled state, disclosure version/acknowledgement, limits and remaining admissions; no secrets   |
| POST `/api/v1/assistant/disclosure`                    | Persist acknowledgement of the current version                                                   |
| POST `/api/v1/conversations`                           | Idempotently create an empty owner-scoped conversation                                           |
| GET `/api/v1/conversations`                            | Cursor-paginated thread list                                                                     |
| GET `/api/v1/conversations/{id}`                       | Paginated ordered turns with attempt status, activity and sources                                |
| POST `/api/v1/conversations/{id}/turns`                | Submit text, submission UUID, and investigation selection; execute once or replay existing state |
| POST `/api/v1/conversations/{id}/turns/{turnId}/retry` | Explicit new idempotent attempt for the latest retryable turn                                    |
| DELETE `/api/v1/conversations/{id}`                    | Delete owned conversation and dependent content; idempotent for absent resources                 |

No model work occurs from GET requests. GET reconciliation can terminalize expired attempts but cannot resume paid work. Mutations require existing Origin/CSRF checks. Missing/non-owned IDs return 404. Add conflict/assistant-specific errors to the existing stable envelope; distinguish busy, daily limit, provider unavailable, refusal, incomplete, invalid response, and interrupted attempts without leaking raw provider errors. Do not reuse the sign-in-specific 429 message for assistant limits.

### 7. In-app presentation and privacy

Replace the signed-in placeholder with `apps/web/src/features/conversation/`. Keep auth state handling and logout; generalize protected-request handling so 401 clears conversation queries and private drafts and cancels in-flight requests before returning to sign-in. Gate late responses by the current auth/conversation generation to prevent stale completions repopulating the UI after logout or deletion.

Visual thesis: a calm writing workspace using the existing warm background, green accent, and readable typography. Content plan: compact thread navigation, transcript as the dominant workspace, composer, and expandable run/source detail. Interaction thesis: clear pending-to-result transitions and responsive navigation with reduced-motion support; avoid ornamental dashboards or fake tool activity.

Use TanStack Query and generated API types, with runtime validation at frontend boundaries. A text draft stays in memory until admission is known; uncertain submissions keep their original key and reconcile through the same idempotent operation or restored history. Do not store private drafts or transcripts in browser local/session storage. Refresh restores accepted text from the backend; it does not promise recovery of an unsent in-memory draft. Mobile thread navigation must retain keyboard focus, readable status announcements, and the composer within the viewport.

First-run disclosure covers selected content, cloud processing, local history, and provider-retention limits. Investigation adds a concise disclosure about derived public-search queries; enabling it must not silently include unrelated threads. Acknowledge the version on the backend. Deletion removes local history and dependent sources/activity, aborts local work where possible, and prevents late writes; it cannot revoke content already sent externally. Keep aggregate daily admission counts after deletion without retaining message content.

### 8. Verification and learning checkpoints

Use injected provider fakes for normal tests and a local HTTP provider stub for adapter tests. No default test makes paid requests. Extend the existing disposable PostgreSQL integration suite; update its fixed expected migration count when adding the migration. Cover real HTTP authorization and CSRF, concurrent/idempotent admission, deadline races, deletion races, retry ordering, and limit persistence across API restart.

Browser acceptance uses synthetic content on phone/desktop: sign in, acknowledge disclosure, send a message, continue with a context-dependent follow-up, refresh during work, recover a failed attempt, inspect activity/sources, delete a conversation, and expire/logout during a request. Include adversarial fixtures for invented action claims, unsafe links, prompt injection, refusal, incomplete responses, and unknown output shapes. Deterministic checks verify enforcement and output handling; they do not prove all generated claims are true.

A separately enabled, bounded live smoke check requires existing server credentials, explicit model/limits, and synthetic input. Record the exact model, one multi-turn discussion, and one public investigation. If configuration is absent, report the live gap; do not add secrets or claim model-quality verification from fixtures. Document the flow and each limitation in `docs/conversation-loop.md` during implementation, and make focused verified commits.

## Risks / Trade-offs

- Foreground requests can be lost on process failure: persisted deadlines expose interruption; explicit retry may incur another charge. Durable unattended execution is a later slice.
- A daily attempt cap is coarse: combine it with bounded input/output/tool calls and show usage; do not describe it as a dollar budget.
- Search queries can reveal details from a pasted message: make investigation explicit, constrain instructions to relevant public facts, and disclose the external query path.
- Provider-attributed content can still be wrong: show sources and uncertainty, preserve evidence distinctions, and evaluate representative scenarios.
- Earlier roadmap artifacts overlap: this change controls the current slice; reconcile capability ownership before archive and leave unmet older tasks open.

## Migration Plan

1. Implement in the four task checkpoints and update milestone documentation without changing unrelated owner-auth code or the existing local generated `next-env.d.ts` modification.
2. Apply new migrations only to the disposable integration database during verification. Existing development data is migrated through the normal documented command, without schema push or volume deletion.
3. Default AI execution off; read-only history remains usable. Enable only after server model/key/finite-limit configuration and disclosure are in place.
4. Roll back to the prior application version with AI disabled; keep additive tables for a forward fix rather than destructively rolling back private history.

## Open Questions

- Which account-available model and tighter personal limits should be configured for the optional live smoke check? No default model, credentials, or paid execution is assumed by this plan.
