# Proposal

## Why

Mentor's owner wants an assistant that investigates important developments and helps them act, with email observation and approved external actions to follow. The next useful foundation is a conversation loop that can understand a request, consult evidence, explain its limits, and continue the same discussion later.

## What Changes

- Add one authenticated, continuous conversation per owner, available automatically on sign-in, with idempotent turns, visible run states, and explicit retry after failure or interruption. No conversation creation, selection, naming, or thread list is exposed.
- Add a backend-owned, bounded assistant runtime and an OpenAI Responses adapter. PostgreSQL owns conversation history; model requests use `store: false` and bounded context.
- Let the assistant choose when to use read-only public-web search from the tools permitted by runtime settings, without a per-message flag or toggle. Show actual search activity and provider-backed source links; pasted email remains conversation input, never permission to act.
- Add a responsive conversation workspace with paginated message history, a draft-preserving composer, run activity, source links, and an explicit Clear history setting. Returning another day or changing topic continues the same conversation.
- Keep credentials server-side; disclose cloud processing before first submission; enforce configured time, input/output, tool-call, and concurrency limits.
- Deliver small verified checkpoints: conversation state and run lifecycle; model integration; in-app conversation; read-only investigation and acceptance.

This change is the next implementation priority. It takes the conversation foundation ahead of the capture/search sequence in `build-personal-knowledge-assistant`. That older change remains a historical roadmap, not authorization to implement its remaining groups. Its overlapping conversation work must be reconciled before either change is archived; this change does not claim to implement library retrieval, personal memory, or proactivity.

Out of scope: multiple conversations or automatic topic/day segmentation, mailbox OAuth/sync, unsolicited/background observation, attention inbox policy, external notifications, arbitrary URL fetching or browser control, write-capable tools, action approvals/execution, long-term personal memory or automatic history summarization, note/image capture, embeddings, library search, and multi-agent orchestration. The first loop can discuss a pasted security notice and investigate public evidence; it cannot establish account exposure without connected account evidence or rotate credentials. Preserving history does not mean every message fits in each model request; context limits are managed internally without asking the owner to start over.

## Capabilities

### New Capabilities

- `assistant-conversation`: One continuous owner-scoped conversation, turns, context, lifecycle, message history, recovery, and history clearing.
- `assistant-runtime`: Bounded model runs, explicit read-only web investigation, evidence presentation, cloud-processing disclosure, and honest capability boundaries.

### Modified Capabilities

None. The main spec inventory is empty; the existing conversational-recall delta belongs to an unarchived broader roadmap.

## Impact

- Reuse existing Next.js presentation, NestJS session/CSRF protection, Drizzle/PostgreSQL, generated OpenAPI client, and isolated test runner.
- Add conversation use cases and repository/provider ports under `packages/backend`, with Drizzle and OpenAI adapters at the boundaries.
- Add versioned database migrations, protected conversation APIs, generated client types, and a web conversation feature replacing the signed-in placeholder.
- Add the official OpenAI Node SDK during implementation, pinned to a tested version; model ID and finite limits are explicit server configuration. No live calls or secrets are needed to plan or run deterministic tests.
- Record migration/API/provider/browser checks and learning notes. Local verification does not imply production deployment or autonomous email monitoring.
