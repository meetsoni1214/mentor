# Checkpoint 3: reviewed mutation decisions

Status: design reviewed and authorized by the owner; implemented in checkpoint 3.
The canonical request flow, recovery behavior, local commands, and verification
are in [the personal-memory walkthrough](personal-memory.md#checkpoint-3-correction-and-forgetting).

## Why retain metadata after forgetting?

Removing an entire row would also remove its original save request ID, allowing
a delayed save to recreate it. Keep the existing row with null wording/source,
its identity, revision, latest mutation ID, and forgetting timestamp. Forgotten
rows are absent from active lists and capacity counts. No old wording, source,
content hash, revision history, command ledger, or extra table is retained.

## Why require revisions and request IDs?

Expected revisions reject edits and deletes based on stale entries. Save IDs
suppress original-save replay; the latest mutation ID recognizes an exact recent
edit. Older edit acknowledgements can become stale after a later change. An
already-forgotten entry confirms the desired state without another mutation.
The current reviewed edit/forget contracts both retain request IDs.

## What does provenance mean after editing?

Correction replaces current wording and its source request together. The browser
currently constructs an explicit command from the edited wording. The source
therefore describes the latest wording operation; it is not an archive of the
original save. The original save ID remains as deduplication metadata.

## Why coordinate with conversation admission?

Memory mutations and conversation admission share the owner lock. A new mutation
is rejected during unexpired generation. Updating memory and advancing the
conversation-owned context boundary happen in one transaction, so neither can
commit alone. Earlier exchanges remain visible but are excluded from subsequent
model context. Clear history resets sequence and boundary together. Model use of
saved memories remains checkpoint 4.

## Browser cleanup decision (2026-11-12)

Share only bounded execution, lifetime cancellation, duplicate-action guards,
and failure classification. Save retains composer-draft handling; edits retain
revision/request/wording checks. Recovery is explicit and never queues a write.
After a conflict, reviewing the latest entry preserves the draft and requires
another deliberate save or forget. The list is the only memory query cache;
selected-entry recovery uses a direct read.

Removing Forget's request ID and replacing the editor's constructed command with
a plain-wording payload are separate future design decisions. Research and
browser artifacts remain separate from the application implementation.
