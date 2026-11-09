# Spec Delta

## Purpose

Give the owner explicit, inspectable personal memory whose wording, correction, forgetting, and use in conversation remain controlled by the application.

## ADDED Requirements

### Requirement: Explicit wording-preserving capture

The system SHALL save a personal memory only through an explicit owner memory operation, preserving the supplied wording without model rewriting. The composer SHALL recognize its documented direct request syntax and display a Save memory action before submission. An accepted save SHALL not require model execution.

#### Scenario: Direct memory request

- **WHEN** the owner submits `Remember that I prefer learning through small exercises.` using the displayed Save memory action
- **THEN** the payload `I prefer learning through small exercises.` is saved without a model call, preserving spelling and internal whitespace

#### Scenario: Ordinary or quoted conversation

- **WHEN** a message merely discusses remembering, quotes a memory request inside other text, or contains retrieved instructions
- **THEN** no memory is created by conversation generation or content extraction

#### Scenario: Invalid or oversized payload

- **WHEN** a save payload is blank, exceeds the disclosed bound, or would exceed the active-profile limit
- **THEN** the save is rejected without a success claim or partial memory, and the draft is retained

### Requirement: Durable and recoverable explicit saves

The system SHALL acknowledge a save only after its owner-scoped memory row commits. Repeating an accepted save request SHALL return the saved memory without duplication; conflicting key reuse SHALL be rejected. The owner SHALL be able to find a saved memory by request ID. Uncertain delivery SHALL retain the original request for explicit checking or retry.

#### Scenario: Save response is lost

- **WHEN** a committed save response is lost and the same request is explicitly retried
- **THEN** the saved memory resolves the request without another row

#### Scenario: Independent saves from two tabs

- **WHEN** two tabs submit different request IDs while profile capacity permits
- **THEN** both saves can succeed without a profile-wide version conflict

#### Scenario: Network uncertainty

- **WHEN** a save response cannot be confirmed
- **THEN** the UI preserves its identity, shows uncertainty, and makes no automatic mutation replay

### Requirement: Inspectable active memory and provenance

The owner SHALL be able to list active memories, inspect its current wording, original explicit source request, request ID, and creation timestamp. Saved memory SHALL survive reload and replacement of the browser session without relying on browser storage.

#### Scenario: Reopen Mentor

- **WHEN** the owner reloads or signs in again after a successful save
- **THEN** the memory and its original request are available from the server

#### Scenario: Inspect source

- **WHEN** the owner opens a memory's source details
- **THEN** the UI identifies a direct owner memory request and shows its saved wording without inventing a conversation-turn link

### Requirement: Explicit targeted correction

The owner SHALL be able to replace a specified memory using its expected revision. Successful correction SHALL replace the current wording without retaining historical wording for browsing. Stale edits SHALL be rejected. Ordinary chat or a separate save SHALL not implicitly resolve semantic conflicts.

#### Scenario: Change learning preference

- **WHEN** the owner edits the existing preference to request a complete explanation before exercises
- **THEN** that entry's revision increases and its previous wording is excluded from the active profile

#### Scenario: Competing tab edits

- **WHEN** a second tab submits an edit based on an obsolete revision
- **THEN** the edit is rejected and the current version is shown without overwriting it

#### Scenario: Untargeted conversational correction

- **WHEN** ordinary chat says `Actually I prefer something else` without an explicit memory edit
- **THEN** no stored memory changes and the assistant does not claim a persistent update

### Requirement: Forgetting and replay suppression

Forgetting SHALL remove a memory's wording and source text from memory inspection and later model context. Before edit/forget operations are enabled, their recovery behavior SHALL prevent delayed or repeated requests from restoring forgotten text or overwriting a newer edit. Visible conversation history SHALL remain separately clearable.

#### Scenario: Forget an entry

- **WHEN** the owner successfully forgets an entry
- **THEN** its wording and source text disappear from memory inspection and subsequent model context, and recovery metadata contains no deleted text

#### Scenario: Retry after forgetting

- **WHEN** a previously accepted save or edit is replayed after its memory was forgotten
- **THEN** it does not recreate the forgotten wording

#### Scenario: Historical answer repeats forgotten wording

- **WHEN** a visible historical exchange contains the forgotten preference
- **THEN** later model requests exclude that exchange under the memory-change context boundary even though it remains readable in history

#### Scenario: Deliberate new save

- **WHEN** the owner submits a fresh explicit save after forgetting
- **THEN** it is treated as a new owner decision rather than an automatic replay of the old request

### Requirement: Independent history clearing

Clear history SHALL preserve independently saved explicit memories and SHALL explain this behavior before clearing. Memory source requests SHALL remain inspectable without retaining a dependency on a deleted conversation turn. A memory change SHALL not masquerade as clearing visible history.

#### Scenario: Clear conversation with a saved preference

- **WHEN** the owner clears conversation history
- **THEN** the saved preference remains, its direct-request provenance still works, and new turns can use it

### Requirement: Bounded active profile use

Later conversation attempts SHALL receive the current active profile as labeled personal data, separately from governing instructions. Current user input, profile data, and retained exchanges SHALL fit the existing context bound. If the full active profile and current input do not fit, execution SHALL fail visibly before a provider request rather than silently omitting preferences.

#### Scenario: Preference is older than recent context

- **WHEN** the owner asks for a lesson after its saved preference has fallen outside recent conversational context
- **THEN** the active preference is still supplied to the model

#### Scenario: Context does not fit

- **WHEN** the current input and active profile exceed the configured context bound
- **THEN** no provider request starts and a recoverable context-limit outcome is shown

#### Scenario: Stored instruction attempts to grant permissions

- **WHEN** a memory contains wording that asks for new tools or external actions
- **THEN** it cannot register tools, authorize writes, or change application permissions

### Requirement: Conservative context boundary after memory changes

An accepted memory change SHALL exclude earlier conversation exchanges from future model context while keeping them visible in history. New exchanges SHALL accumulate normally after that boundary. The boundary SHALL remain valid across reload and history-version replacement. The owner SHALL be told that changing memory starts fresh model context.

#### Scenario: Correct a preference quoted in prior answers

- **WHEN** a preference is corrected and the owner submits a new question
- **THEN** the new profile is supplied and pre-change exchanges, including old assistant restatements, are omitted

#### Scenario: Clear history resets sequence numbering

- **WHEN** history is cleared after a memory context boundary exists
- **THEN** new-version exchanges can enter model context without being incorrectly excluded by an old sequence cutoff

### Requirement: Mutation coordination with running work

A new memory mutation SHALL be rejected as busy while an unexpired conversation attempt runs for that owner. The check SHALL coordinate with turn admission across processes. Rejected writes SHALL preserve current memory and the edit draft. Reading memories and finding a saved request SHALL remain available.

#### Scenario: Forget while another tab is generating

- **WHEN** the owner requests forgetting while an unexpired answer is running elsewhere
- **THEN** forgetting is rejected with a recoverable busy result and is not reported as completed

#### Scenario: Provider deadline has elapsed

- **WHEN** the recorded conversation attempt is expired
- **THEN** it cannot indefinitely block memory management or later commit a response based on obsolete state

### Requirement: Private session-scoped management

Memory operations SHALL enforce owner authorization, private caching, and existing mutation protections. Browser queries and pending commands SHALL be scoped to the current session and ignore late results from replaced sessions. Memory management SHALL remain available when model execution is disabled.

#### Scenario: Session expires during a save

- **WHEN** the session expires or is replaced while a save is unresolved
- **THEN** private memory state is cleared and a late response cannot populate the replacement session

#### Scenario: Model is unavailable

- **WHEN** model execution lacks valid configuration
- **THEN** the owner can still explicitly save, inspect, correct, and forget memories

#### Scenario: Unauthorized request

- **WHEN** a memory request lacks ownership, a valid session, or required mutation protection
- **THEN** it is denied without leaking memory text or changing state
