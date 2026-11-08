# Spec Delta

## Purpose

Give the authenticated owner one continuous conversation with Mentor that resumes automatically and recovers from interrupted assistant work without losing accepted input.

## ADDED Requirements

### Requirement: One continuous private conversation

The system SHALL provide exactly one continuous conversation per owner, opened automatically on sign-in, with ordered messages and run states. It SHALL NOT expose conversation creation, selection, naming, or a thread list. Operations SHALL enforce ownership and private caching; mutations SHALL enforce session, Origin, and CSRF protections.

#### Scenario: Resume after signing in again

- **WHEN** the owner refreshes or signs in again
- **THEN** accepted messages, completed responses, sources, and run states remain available in their original order

#### Scenario: First visit and concurrent first use

- **WHEN** the owner first opens Mentor, including from multiple tabs
- **THEN** the same initially empty conversation is available without a creation or selection step, and concurrent first submissions cannot create multiple conversations

#### Scenario: Return another day or change topic

- **WHEN** the owner returns another day or discusses a different topic
- **THEN** Mentor continues the same conversation without prompting for or automatically creating another conversation

#### Scenario: Unauthorized conversation access

- **WHEN** a request lacks a valid session, targets a conversation belonging to another owner, or fails mutation protections
- **THEN** the request is denied without revealing conversation contents or starting model work

### Requirement: Idempotent turn admission

The system SHALL acknowledge a turn only after committing its user message and run record. Repeated submission of the same owner-scoped request identifier and payload SHALL return the same turn without repeating model work or starting another SDK runner. Reuse with different input SHALL be rejected. The system SHALL allow at most one active run per conversation. Internal SDK model/tool steps SHALL remain within that admitted attempt rather than creating additional user turns or attempts.

#### Scenario: Lost submission response

- **WHEN** the client retries an accepted submission using the same identifier and payload
- **THEN** the existing turn and its current state are returned without another user message or provider request

#### Scenario: Concurrent submissions

- **WHEN** a second distinct turn is submitted while a conversation has an active run
- **THEN** it is rejected with a recoverable busy response and its text remains in the composer

### Requirement: Observable run lifecycle

The system SHALL distinguish running, completed, failed, and interrupted attempts. Refresh or connection loss SHALL not imply cancellation or replacement. Only successful final SDK output accepted by application completion checks SHALL become a completed answer. Intermediate results SHALL not become completed entries. Expired attempts SHALL become interrupted; late output SHALL not overwrite terminal state.

#### Scenario: Refresh during generation

- **WHEN** the owner refreshes while an attempt is running
- **THEN** the app restores that attempt's status and eventually displays its persisted result or terminal failure

#### Scenario: Process failure and late result

- **WHEN** an attempt exceeds its execution deadline or the API stops before committing its answer
- **THEN** status reconciliation marks it interrupted and rejects any later completion for that attempt, without claiming SDK execution guarantees automatic recovery or background completion

### Requirement: Explicit retry

The owner SHALL be able to retry only the latest failed or interrupted turn with a fresh attempt key, preserving the original message and earlier attempts. Retry SHALL use fresh admission checks and application-owned context for a new bounded SDK run. Completed or older turns SHALL NOT be retried. Uncertain provider outcomes SHALL NOT trigger automatic retries or intermediate-state resumption.

#### Scenario: Provider times out

- **WHEN** a model attempt times out and the owner chooses Retry
- **THEN** a new bounded attempt is recorded against the original turn and the previous attempt remains visibly unsuccessful

#### Scenario: Older failed turn

- **WHEN** the owner attempts to retry a failed turn after a newer turn exists
- **THEN** retry is rejected and the app offers to start a new message instead

### Requirement: Recoverable streamed retry

The browser SHALL offer `Retry response` on an eligible turn and consume authenticated SSE for acceptance, provisional text, and the persisted outcome. All retry delivery outcomes SHALL preserve the composer draft. Uncertain delivery SHALL retain the original retry command for explicit reconciliation, with session/history replacement clearing private state as usual.

#### Scenario: Retry action is unavailable

- **WHEN** execution is unavailable, history/status is not ready, sign-out is in progress, a mutation is unresolved, or an attempt is running
- **THEN** the retry action is disabled and cannot start another attempt

#### Scenario: Retry streams on the original message

- **WHEN** the owner retries the latest failed or interrupted turn while a different draft is in the composer
- **THEN** one fresh attempt is recorded on the original turn, earlier attempts remain inspectable, provisional text appears on that turn, and retry acceptance and completion preserve the draft

#### Scenario: Duplicate retry clicks and request replay

- **WHEN** the owner clicks retry repeatedly or explicitly replays an unresolved retry command
- **THEN** duplicate in-flight actions do not allocate another retry key, and replay with the same turn ID, request ID, and history version returns the saved attempt without duplicating the message or starting another runner

#### Scenario: Retry delivery is uncertain

- **WHEN** the retry's acceptance is not received
- **THEN** the browser retains the original retry command and checks the target turn's attempt request IDs in saved history; the original message request ID or an older failed attempt cannot confirm or settle the retry, and only explicit recovery after a successful fresh history check may replay the same command

#### Scenario: Retry history check fails

- **WHEN** the owner requests recovery but saved history cannot be read
- **THEN** the retry command remains unresolved, the composer draft is preserved, and no POST is sent

#### Scenario: Another tab changes retry eligibility

- **WHEN** a newer turn or running attempt makes a displayed retry action stale before admission
- **THEN** server admission rejects the retry without starting another run, the browser refreshes saved history and explains the outcome, and the composer draft is preserved

#### Scenario: Retry loses its stream or reloads

- **WHEN** an accepted retry disconnects, produces invalid events, becomes idle, or the page reloads
- **THEN** saved history and foreground polling recover the attempt's outcome without automatic POST replay, and no replacement model attempt starts merely because live delivery ended

### Requirement: Bounded conversation context

Each new user turn SHALL start from the current message and bounded completed turns from the owner's PostgreSQL conversation. Failed or incomplete output SHALL be excluded from later turns. Older history SHALL remain browsable when omitted from model context. The app SHALL disclose limited context without requiring a new conversation or implying complete long-term recall.

#### Scenario: Long conversation

- **WHEN** complete history exceeds the configured input bound
- **THEN** the current message and the newest complete turn pairs that fit are used, older history remains browsable, and limited context is disclosed without asking the owner to create a new conversation

### Requirement: Application-owned SDK conversation state

PostgreSQL SHALL remain the sole durable conversation and attempt authority. The system SHALL not introduce a second SDK session transcript store or provider-managed conversation/response-ID chain. Required intermediate SDK items MAY remain in memory during the active run, under the SDK's normal execution behavior and application deadline, but SHALL not become durable raw run or hidden reasoning records.

#### Scenario: Follow-up after a completed SDK run

- **WHEN** the owner sends another message after a successful response
- **THEN** context is rebuilt from the application-owned transcript without duplicating messages through SDK session writes or replaying raw intermediate run state

### Requirement: Recoverable conversation interface

The app SHALL open directly to an accessible continuous transcript, history pagination, text composer, run status, source links, and recoverable errors on phone and desktop. Failed admission SHALL preserve the draft. Uncertain submission SHALL retain its request identifier for reconciliation. Session loss or logout SHALL clear private in-memory state and prevent late requests from repopulating it.

#### Scenario: Session expires during submission

- **WHEN** a protected conversation request returns an expired-session response
- **THEN** the app returns to sign-in, clears private conversation state, and does not automatically resubmit after sign-in

### Requirement: Explicit history clearing

The owner SHALL be able to clear all messages, attempts, and source/activity records through explicit header confirmation while retaining the empty conversation. Application version/completion checks SHALL exclude cleared content from reads and future context and reject stale submissions and late SDK output. Cancellation SHALL propagate to the runner where possible. The app SHALL explain that local clearing cannot retract content already sent to a provider.

#### Scenario: Clear during investigation

- **WHEN** the owner clears history while its provider request is running
- **THEN** local content is removed, the same conversation becomes empty, and late output, SDK cleanup, or automatic transcript writes cannot restore cleared messages

#### Scenario: Clear between SDK steps

- **WHEN** local cancellation reaches the runner after one step and before another starts
- **THEN** no subsequent SDK model or tool operation starts for the cancelled attempt, and a new-version conversation cannot inherit its intermediate state

#### Scenario: Stale tab resubmits after clearing

- **WHEN** another tab retries a pre-clear submission, retry, or clear request
- **THEN** it is rejected as stale without new model work or removal of newer messages, and the tab reloads current state

#### Scenario: Cancel history-clear confirmation

- **WHEN** the owner cancels the clear confirmation or presses Escape before confirming
- **THEN** no deletion occurs, the draft and conversation remain, and keyboard focus returns to the invoking control

#### Scenario: Lost clear response

- **WHEN** a confirmed clear has no trustworthy response
- **THEN** the browser retains the original expected history version, pauses new sends and retries, and offers read-only history checking and explicit same-version clear recovery without automatic deletion replay

#### Scenario: History read precedes pending deletion

- **WHEN** a recovery read returns the original history version while a clear remains unconfirmed
- **THEN** the browser preserves uncertainty because that read does not prove deletion failed, and a failed check issues no write

#### Scenario: Messages arrive after clearing

- **WHEN** another tab adds a message under the new version before the post-clear read
- **THEN** the browser loads that current history instead of overwriting it with an assumed empty transcript, and clearing the newer version requires fresh confirmation

#### Scenario: Clear confirmed but history refresh fails

- **WHEN** deletion succeeds but current history cannot be loaded
- **THEN** old drafts, provisional text, and saved pages remain absent from the displayed conversation, and recovery reads history without repeating deletion

### Requirement: Provisional browser response display

The browser SHALL consume authenticated SSE for submission and retry with session and mutation protections. It SHALL validate event identities and keep provisional text outside saved history. Admission SHALL end confirmation waiting, clearing only a new message's submitted draft and preserving the draft for retry. Final output SHALL NOT clear the next draft. Saved terminal results SHALL supersede provisional text.

#### Scenario: Healthy live response

- **WHEN** admission and text events arrive for the current session, history version, turn, and attempt
- **THEN** the submitted draft clears on acceptance, provisional text appears before completion, the next draft remains editable, and periodic history polling pauses for that live attempt

#### Scenario: Healthy live retry

- **WHEN** accepted retry events match the requested history version, turn ID, and new attempt request ID
- **THEN** the current draft is preserved, provisional text appears before completion, and periodic history polling pauses while the matching live retry stream is healthy

#### Scenario: Retry stream identity mismatch

- **WHEN** a retry stream reports a different turn or attempt request ID, even if it matches the original message submission key
- **THEN** the browser rejects the events and recovers through saved history without publishing mismatched content or automatically replaying the retry

#### Scenario: Lost or invalid stream

- **WHEN** a stream disconnects, becomes silent, or delivers invalid events before a final result
- **THEN** provisional text is discarded, accepted work is reconciled through saved history and foreground polling, and no mutation is automatically replayed

#### Scenario: Saved failure or obsolete stream

- **WHEN** saved history settles an attempt, history changes, or the session is replaced
- **THEN** terminal history takes precedence and obsolete provisional text and late events cannot restore private content
