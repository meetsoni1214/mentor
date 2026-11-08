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

The owner SHALL be able to retry the latest failed or interrupted turn using a new attempt identifier without duplicating the original message. Retry SHALL require fresh admission checks and start a fresh bounded SDK run from application-owned context; it SHALL not automatically resume uncertain intermediate SDK state. Retry SHALL never happen automatically after an uncertain provider outcome. Completed turns and turns preceding newer messages SHALL not be retried through this operation.

#### Scenario: Provider times out

- **WHEN** a model attempt times out and the owner chooses Retry
- **THEN** a new bounded attempt is recorded against the original turn and the previous attempt remains visibly unsuccessful

#### Scenario: Older failed turn

- **WHEN** the owner attempts to retry a failed turn after a newer turn exists
- **THEN** retry is rejected and the app offers to start a new message instead

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

The owner SHALL be able to clear all messages, attempts, and source/activity records through a privacy setting while retaining the empty conversation. Application version/completion checks SHALL exclude cleared content from reads and future context and reject stale submissions and late SDK output. Cancellation SHALL propagate to the runner where possible. The app SHALL explain that local clearing cannot retract content already sent to a provider.

#### Scenario: Clear during investigation

- **WHEN** the owner clears history while its provider request is running
- **THEN** local content is removed, the same conversation becomes empty, and late output, SDK cleanup, or automatic transcript writes cannot restore cleared messages

#### Scenario: Clear between SDK steps

- **WHEN** local cancellation reaches the runner after one step and before another starts
- **THEN** no subsequent SDK model or tool operation starts for the cancelled attempt, and a new-version conversation cannot inherit its intermediate state

#### Scenario: Stale tab resubmits after clearing

- **WHEN** another tab retries a pre-clear submission, retry, or clear request
- **THEN** it is rejected as stale without new model work or removal of newer messages, and the tab reloads current state

### Requirement: Provisional browser response display

The browser SHALL consume authenticated SSE submission using the existing session and mutation protections. It SHALL validate event identities and display provisional answer text separately from saved history. Committed admission SHALL clear only the submitted draft and end delivery confirmation waiting; final output SHALL NOT clear the next draft. Saved terminal results SHALL supersede provisional text.

#### Scenario: Healthy live response

- **WHEN** admission and text events arrive for the current session, history version, turn, and attempt
- **THEN** the submitted draft clears on acceptance, provisional text appears before completion, the next draft remains editable, and periodic history polling pauses for that live attempt

#### Scenario: Lost or invalid stream

- **WHEN** a stream disconnects, becomes silent, or delivers invalid events before a final result
- **THEN** provisional text is discarded, accepted work is reconciled through saved history and foreground polling, and no mutation is automatically replayed

#### Scenario: Saved failure or obsolete stream

- **WHEN** saved history settles an attempt, history changes, or the session is replaced
- **THEN** terminal history takes precedence and obsolete provisional text and late events cannot restore private content
