# Spec Delta

## Purpose

Maintain an inspectable understanding of the owner that supports exploration and personalization without treating model guesses as personal facts or commitments.

## ADDED Requirements

### Requirement: Distinguish evidence and intent
The system SHALL distinguish owner-stated information from assistant inferences and SHALL distinguish interests, intentions, and confirmed commitments. Memory SHALL retain provenance, update time, and confirmation status.

#### Scenario: Repeated interest
- **WHEN** the owner saves several articles about startups
- **THEN** the assistant can suggest an interest in entrepreneurship but does not create a commitment to launch a company

### Requirement: Inspect and correct memory
The owner SHALL be able to list, edit, confirm, reject, and delete personal-memory entries. Explicit owner corrections SHALL override assistant inferences.

#### Scenario: Correct a preference
- **WHEN** the owner corrects an inferred preference
- **THEN** subsequent personalization uses the corrected entry and retains the correction's provenance

### Requirement: Handle conflicting and changing context
The system SHALL flag conflicting personal information and SHALL NOT silently replace an explicit owner statement with an inference. Superseded entries SHALL be excluded from current personalization.

#### Scenario: Conflicting saved advice
- **WHEN** an article recommends morning workouts while the owner prefers evenings
- **THEN** the article does not change the owner's preference

#### Scenario: Owner changes direction
- **WHEN** the owner explicitly states that a previously confirmed commitment is no longer active
- **THEN** the commitment is marked inactive and related pending reminders stop

### Requirement: Conservative sensitive inference
The system SHALL require owner confirmation before using inferred health or relationship attributes for personalization, and SHALL present possible relevance without diagnosing or deciding personal matters for the owner.

#### Scenario: Saving relationship advice
- **WHEN** the owner saves an article about a relationship difficulty
- **THEN** the assistant does not record that the owner has that difficulty as a confirmed personal fact

### Requirement: Forgetting propagates
The system SHALL remove deleted memories from future prompts and suggestions. Deleted source material SHALL invalidate solely derived memories, and rejected inferences SHALL not be recreated from unchanged evidence.

#### Scenario: Reject an inference
- **WHEN** the owner rejects an inference and a later background review reads the same evidence
- **THEN** that inference remains excluded unless the owner provides new explicit information

#### Scenario: Delete the only supporting source
- **WHEN** the owner deletes the sole source of an unconfirmed memory
- **THEN** that memory is invalidated and no longer influences new responses or suggestions

### Requirement: Export personal understanding
The system SHALL include active personal-memory entries, confirmation status, and provenance in the owner's structured data export.

#### Scenario: Inspect exported profile
- **WHEN** the owner exports their data
- **THEN** they can distinguish statements they confirmed from assistant inferences in the exported memory
