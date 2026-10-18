# Spec Delta

## Purpose

Let the owner recover and discuss saved knowledge through natural conversation with verifiable sources and honest limits on what the assistant knows.

## ADDED Requirements

### Requirement: Persistent conversation
The system SHALL retain conversation history across sessions and show pending, completed, failed, or interrupted assistant turns. Repeated submissions with the same identifier SHALL not create duplicate turns.

#### Scenario: Resume a conversation
- **WHEN** the owner reopens the app after a completed conversation
- **THEN** previous messages and their source references remain available

#### Scenario: Interrupted answer
- **WHEN** processing stops before an answer completes
- **THEN** the turn is shown as interrupted or failed and partial text is not presented as a completed answer

### Requirement: Source-backed retrieval
The system SHALL retrieve relevant saved material using meaning and keywords, apply requested filters, and attach references to library-derived claims. References SHALL resolve to authorized source items and available source locations.

#### Scenario: Recall without exact words
- **WHEN** the owner asks for previously saved guidance about talking to potential customers
- **THEN** relevant customer-interview material can be retrieved even when its title uses different wording, with links to the saved sources

#### Scenario: Open supporting evidence
- **WHEN** the owner opens a reference in an answer
- **THEN** the app displays the original item and the cited passage, PDF page, or image as available

### Requirement: Honest knowledge boundaries
The assistant SHALL state when no supporting saved material is found and SHALL distinguish general suggestions from conclusions drawn from the library. It SHALL NOT invent citations or claim that retrieval covered every saved item when processing is incomplete.

#### Scenario: No relevant source
- **WHEN** the owner asks about something absent from the library
- **THEN** the assistant explains that it found no supporting saved material and labels any general advice separately

#### Scenario: Fabricated source identifier
- **WHEN** model output contains a source identifier outside the retrieved authorized evidence
- **THEN** that identifier is not rendered as a valid citation and the answer is corrected or marked unsupported

### Requirement: Explicit capture and actions
The system SHALL provide an explicit save action for text and SHALL save submitted supported attachments and article links. Ambiguous conversational requests SHALL not silently create reminders, commitments, or unrelated library entries.

#### Scenario: Save a text note
- **WHEN** the owner submits text using the save action
- **THEN** the app confirms the stored item using its actual capture result

#### Scenario: Discussion without commitment
- **WHEN** the owner says they are considering a new fitness routine
- **THEN** the assistant can discuss it without creating a scheduled commitment

### Requirement: Bounded and transparent AI work
The system SHALL enforce configurable request, time, and usage limits. Provider failures, refusals, and exhausted budgets SHALL produce honest recoverable states while preserving user input and saved material.

#### Scenario: AI budget exhausted
- **WHEN** the configured AI allowance is exhausted
- **THEN** new AI work pauses with an explanation while saving, browsing, and keyword search remain available

### Requirement: Conversation deletion and export
The owner SHALL be able to export and delete conversation history. Deleted messages SHALL be excluded from future context and SHALL invalidate solely derived unconfirmed memory.

#### Scenario: Delete a conversation
- **WHEN** the owner deletes a conversation
- **THEN** its content is no longer supplied to new model requests and deletion does not remove separately saved library originals
