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

The system SHALL acknowledge a turn only after committing its user message and run record. Repeated submission of the same owner-scoped request identifier and payload SHALL return the same turn without repeating model work. Reuse with different input SHALL be rejected. The system SHALL allow at most one active run per conversation.

#### Scenario: Lost submission response

- **WHEN** the client retries an accepted submission using the same identifier and payload
- **THEN** the existing turn and its current state are returned without another user message or provider request

#### Scenario: Concurrent submissions

- **WHEN** a second distinct turn is submitted while a conversation has an active run
- **THEN** it is rejected with a recoverable busy response and its text remains in the composer

### Requirement: Observable run lifecycle

The system SHALL distinguish running, completed, failed, and interrupted attempts. Refreshing or losing a browser connection SHALL not imply cancellation or trigger a replacement run. Only successful final output SHALL appear as a completed answer. Expired attempts SHALL become interrupted, and late output SHALL not overwrite terminal state.

#### Scenario: Refresh during generation

- **WHEN** the owner refreshes while an attempt is running
- **THEN** the app restores that attempt's status and eventually displays its persisted result or terminal failure

#### Scenario: Process failure and late result

- **WHEN** an attempt exceeds its execution deadline or the API stops before committing its answer
- **THEN** status reconciliation marks it interrupted and rejects any later completion for that attempt

### Requirement: Explicit retry

The owner SHALL be able to retry the latest failed or interrupted turn using a new attempt identifier without duplicating the original message. Retry SHALL require fresh admission checks and SHALL never happen automatically after an uncertain provider outcome. Completed turns and turns preceding newer messages SHALL not be retried through this operation.

#### Scenario: Provider times out

- **WHEN** a model attempt times out and the owner chooses Retry
- **THEN** a new bounded attempt is recorded against the original turn and the previous attempt remains visibly unsuccessful

#### Scenario: Older failed turn

- **WHEN** the owner attempts to retry a failed turn after a newer turn exists
- **THEN** retry is rejected and the app offers to start a new message instead

### Requirement: Bounded conversation context

New model requests SHALL use the current message and bounded completed turns from the owner's continuous conversation. Failed or incomplete output SHALL be excluded. Older history SHALL remain browsable when omitted from model context. The app SHALL disclose limited context without requiring a new conversation or implying complete long-term recall.

#### Scenario: Long conversation

- **WHEN** complete history exceeds the configured input bound
- **THEN** the current message and the newest complete turn pairs that fit are used, older history remains browsable, and limited context is disclosed without asking the owner to create a new conversation

### Requirement: Recoverable conversation interface

The app SHALL open directly to an accessible continuous transcript, history pagination, text composer, run status, source links, and recoverable errors on phone and desktop. Failed admission SHALL preserve the draft. Uncertain submission SHALL retain its request identifier for reconciliation. Session loss or logout SHALL clear private in-memory state and prevent late requests from repopulating it.

#### Scenario: Session expires during submission

- **WHEN** a protected conversation request returns an expired-session response
- **THEN** the app returns to sign-in, clears private conversation state, and does not automatically resubmit after sign-in

### Requirement: Explicit history clearing

The owner SHALL be able to explicitly clear all messages, attempts, and source/activity records through a privacy setting. The same conversation SHALL remain available, empty. Clearing SHALL exclude removed content from reads and future context, reject stale submissions and late output, and explain that local deletion cannot retract content already sent to a provider.

#### Scenario: Clear during investigation

- **WHEN** the owner clears history while its provider request is running
- **THEN** local content is removed, the same conversation becomes empty, and late output cannot restore cleared messages

#### Scenario: Stale tab resubmits after clearing

- **WHEN** another tab retries a pre-clear submission, retry, or clear request
- **THEN** it is rejected as stale without new model work or removal of newer messages, and the tab reloads current state
