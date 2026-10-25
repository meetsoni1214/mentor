# Spec Delta

## Purpose

Let the authenticated owner discuss a request with Mentor, resume the discussion later, and recover from interrupted assistant work without losing accepted input.

## ADDED Requirements

### Requirement: Private persistent conversations

The system SHALL let the authenticated owner create, list, and reopen text conversations with ordered messages and run states. Every conversation operation SHALL enforce ownership and private response caching. Mutations SHALL enforce the existing session, Origin, and CSRF protections.

#### Scenario: Resume after signing in again

- **WHEN** the owner returns to an existing conversation after refreshing or signing in again
- **THEN** accepted messages, completed responses, sources, and run states remain available in their original order

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

New model requests SHALL use only the current owner's selected conversation, the current message, and bounded prior completed turns. Incomplete or failed output SHALL be excluded. When older turns are omitted, the app SHALL indicate that context is limited. Cross-thread personal memory SHALL not be implied.

#### Scenario: Long conversation

- **WHEN** complete history exceeds the configured input bound
- **THEN** the current message and the newest complete turn pairs that fit are used and omitted history is disclosed

### Requirement: Recoverable conversation interface

The app SHALL provide accessible phone and desktop conversation navigation, a text composer, run status, source links, and recoverable errors. Failed admission SHALL preserve the draft. Uncertain submission SHALL retain its request identifier for reconciliation. Session loss or logout SHALL clear private in-memory state and prevent late requests from repopulating it.

#### Scenario: Session expires during submission

- **WHEN** a protected conversation request returns an expired-session response
- **THEN** the app returns to sign-in, clears private conversation state, and does not automatically resubmit after sign-in

### Requirement: Conversation deletion

The owner SHALL be able to delete a conversation and its messages, attempts, and source/activity records. Deleted content SHALL be unavailable to future context and reads. Deletion during a run SHALL prevent completion from recreating the conversation. The system SHALL explain that local deletion cannot retract content already sent to a provider.

#### Scenario: Delete during investigation

- **WHEN** the owner deletes a conversation while its provider request is running
- **THEN** the conversation becomes unavailable immediately, local content is removed, and a late provider result cannot recreate it
