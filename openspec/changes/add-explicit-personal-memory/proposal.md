# Proposal

## Why

Mentor can retain a conversation but cannot yet deliberately remember an owner's preference beyond recent model context. The local Mem0/Hindsight evaluation showed that extraction and search do not replace explicit rules for corrections and forgetting, so the next milestone should establish those rules through small, reviewable slices.

## What Changes

- Add explicit personal memory stored in Mentor's PostgreSQL database, preserving the owner's wording and direct-request provenance in one `memories` table.
- Recognize a documented direct `Remember that …` request in the composer, show that its action is **Save memory**, and route it to a dedicated application operation without model extraction or a model write tool. Ordinary conversation remains conversation.
- Provide a small Memory panel for inspection, targeted correction, and forgetting. A correction explicitly identifies its existing memory; unrelated new saves do not silently replace other entries.
- Supply a compact active profile to later conversation attempts within the existing context bound. Establish a conservative context boundary after memory changes so older exchanges cannot silently reintroduce superseded or forgotten facts.
- Preserve request identity on uncertain writes, enforce ownership/CSRF, add entry-level stale-edit protection when correction is implemented, and keep memory management available without configured model execution.
- Deliver five independently reviewed checkpoints: durable API save/inspect; composer and Memory panel; correct/forget; use safely in conversation; integrated acceptance. Stop after each checkpoint until the owner requests the next. Commit or archive only when requested.

Explicitly deferred: automatic memory discovery, model rewriting, arbitrary natural-language intent recognition, embeddings, semantic retrieval, documents/screenshots, memory vendors, background consolidation, inferred traits, reminders, and external actions. The owner confirmed direct wording capture and then requested a simpler design: one table, no revision history, no profile-wide versioning, and no separate command receipts. Edit/forget recovery is deliberately designed at checkpoint 3 before those operations are enabled; other future user-facing defaults remain proposed for review.

## Capabilities

### New Capabilities

- `personal-memory`: Explicit owner-requested memory, duplicate-save protection and provenance, inspection, correction, forgetting, and bounded use in conversation.

### Modified Capabilities

None exist under `openspec/specs/` yet. The unarchived conversation change already owns conversation lifecycle behavior, and the older roadmap proposes a broader `personal-memory` capability. Reuse that capability path here, define only the explicit-memory subset, and reconcile ownership before either overlapping change is archived. This change does not declare the older roadmap's inferred memory, export, or proactivity implemented.

## Impact

- New memory domain/application/ports/Drizzle adapters under `packages/backend/src/memory`, explicit package entry points, architecture-rule coverage, and versioned migrations.
- New authenticated memory HTTP adapters/module, generated OpenAPI/client contracts, browser-owned validation, scoped queries/write recovery, and a Memory panel using existing brand tokens and shadcn controls.
- Focused conversation context/composition changes and database coordination with the existing owner lock; the existing turn, retry, streaming, search, and history semantics remain compatible.
- Proposed defaults: explicit memories survive **Clear history**, a memory mutation is rejected while an unexpired conversation attempt runs, and any accepted memory change starts fresh model context while leaving visible history readable. The UI must explain these behaviors.
- Verification uses injected models, localhost SDK stubs, disposable PostgreSQL, and local phone/desktop acceptance. No paid provider call is required or authorized by this plan.
