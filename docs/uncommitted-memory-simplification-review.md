# Uncommitted memory changes: simplification review

Review date: 2026-11-12

The backend protections are mostly justified. The browser recovery code has the
clearest opportunities to simplify. A focused cleanup is preferable to a redesign.

The tracked diff adds about 2,100 lines, but roughly 775 are generated API
contracts. Tests and documentation account for another substantial portion, so
the diff's size overstates the runtime complexity.

## 1. Remove the unused memory-detail cache

[`memory-queries.ts`](../apps/web/src/features/memory/state/memory-queries.ts)
defines `detailOptions()` and populates a detail cache after changes. No production
component consumes that query; its only consumer is a test. Recovery already uses
the direct `read()` operation.

Remove the detail query and its cache writes. Keep the list cache update and
cancellation of stale reads: those prevent old wording from reappearing after an
edit or forget.

## 2. Consolidate duplicated recovery mechanics

The new
[`use-memory-change.ts`](../apps/web/src/features/memory/state/use-memory-change.ts)
repeats machinery already in `use-memory.ts`: component lifetime cancellation,
duplicate-click guards, mutation execution, and check/retry handling.

Similarly,
[`memory-change.ts`](../apps/web/src/features/memory/state/memory-change.ts)
duplicates the timeout/abort race in `memory-save.ts`, while rejection
classification appears in both recovery flows.

Share a small amount of execution and error-classification code. Keep save-specific
draft handling and edit-specific revision checks separate. A configurable, generic
mutation framework would likely create more complexity than it removes.

## 3. Simplify editor state and fix conflict recovery

[`memory-panel.tsx`](../apps/web/src/features/memory/ui/memory-panel.tsx)
combines a selected entry snapshot, a draft, mutation success, pending/uncertain
flags, and the latest list entry.

There is a concrete problem: after a revision conflict, the panel can show the
latest wording, but subsequent Save requests still use
`selected.entry.revision`, the old revision. From code inspection, saving again
will conflict until the user cancels and reopens the entry.

Give conflicts one explicit resolution: review/reopen the latest entry while
preserving the draft. Also remove redundant state such as
`working = selected && !succeeded`; success already clears `selected`.

## 4. Forget probably does not need its own request ID

In
[`PersonalMemory.forget()`](../packages/backend/src/memory/application/personal-memory.ts),
an already-forgotten entry immediately returns success, regardless of the incoming
request ID. Browser recovery likewise accepts any forgotten outcome.

Forgetting therefore already behaves as “ensure this entry is forgotten,” rather
than “prove this exact delete command executed.”

A simpler contract could use entry ID plus expected revision, preserving
stale-delete protection. That would remove forget-specific UUID generation,
collision checks, and mutation-ID tracking. Keep request IDs for saves and edits,
where they serve a stronger purpose.

This changes the reviewed contract, so treat it as a deliberate design adjustment.

## 5. Remove the editor's synthetic capture-command coupling

The panel takes plain wording, constructs `Remember that ${draft}`, then sends it
through the chat-command parser.

An explicit editor could submit `{ text, expectedRevision, requestId }` and share
plain-wording validation with chat capture. Chat capture would remain responsible
for recognizing “Remember that”.

This requires deciding what `sourceRequest` means after editing. Currently it
becomes a constructed command, so it should not be treated as an untouched record
of what the owner originally typed.

## 6. Reduce documentation duplication and separate artifacts

Mutation behavior is repeated across the personal-memory guide, mutation-design
document, OpenSpec design, and specs. Keep one implementation walkthrough and link
to it from planning documents.

Review the untracked research, evaluation outputs, browser snapshots, and image
separately from this feature. Their presence does not mean the application needs
them at runtime.

## Protections to retain

- **Revision checks:** prevent stale tabs from overwriting newer edits.
- **Content-free forgotten records:** prevent delayed save requests from
  recreating forgotten content.
- **Shared owner lock:** coordinates memory mutations with conversation admission.
- **Atomic context-boundary updates:** keep the memory change and context reset
  consistent. The single context-boundary field is already a relatively simple
  solution.
- **Explicit recovery without automatic replay:** preserves uncertainty without
  silently repeating writes.

## Recommended first cleanup

Remove the unused detail cache, consolidate duplicated recovery mechanics, and
simplify the editor's conflict state. These offer useful reductions with minimal
behavior changes. Consider the forget contract and editor payload changes as
separate design decisions.

## Verification and limits

The review changed no implementation files. All 90 targeted tests passed across
`memory-change.test.ts`, `memory-api.test.ts`, `memory-save.test.ts`, and
`personal-memory.test.ts`. `git diff --check` also passed.

Full integration and browser acceptance were not rerun. The editor conflict
finding is based on code inspection.

## Implementation follow-up (2026-11-12)

The owner approved items 1–3 and focused documentation consolidation. Detail
caching is removed; shared helpers own bounded execution, lifetime cancellation,
duplicate-action guarding, and failure classification. The editor requires
explicit latest-version review while retaining the draft, including retrying a
failed latest-entry read. Reviewing never submits a write. Save-specific draft
handling and edit-specific revision/identity validation remain separate.

The implementation walkthrough is maintained in
[personal-memory.md](personal-memory.md#checkpoint-3-correction-and-forgetting);
mutation design records and OpenSpec link to it. Items 4–5 remain separate design
choices. No API contract, migration, or backend policy changed in this cleanup.
See the walkthrough's cleanup report for current verification and limits.
