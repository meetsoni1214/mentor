# Spec Delta

## Purpose

Capture personal reference material in a durable, organized library while retaining originals and allowing the owner to correct AI interpretations.

## ADDED Requirements

### Requirement: Durable supported capture
The system SHALL accept text notes, HTTP(S) article URLs, JPEG/PNG/WebP screenshots or images, and text-based PDFs. It SHALL preserve accepted input before acknowledging that it was saved and SHALL display supported formats and limits.

#### Scenario: Screenshot capture
- **WHEN** the owner submits a supported screenshot within the upload limit
- **THEN** the system saves the original and creates a library item before acknowledging success

#### Scenario: Unsupported input
- **WHEN** the owner submits audio, video, an unsupported file, or an oversized input
- **THEN** the application explains the limitation and does not claim the item was saved or processed

### Requirement: Processing state and recovery
The system SHALL display saved, processing, ready, needs-review, or failed status and SHALL permit retrying recoverable failures without creating duplicate items. Accepted work SHALL survive an application restart.

#### Scenario: Cloud service failure
- **WHEN** the model service is unavailable after a successful capture
- **THEN** the original remains accessible and the item shows a recoverable processing state

#### Scenario: Request retry
- **WHEN** a capture request is repeated with the same submission identifier after a lost response
- **THEN** the system returns the existing item rather than saving another copy

### Requirement: Honest extraction
The system SHALL retain source locations for extracted content and SHALL flag unreadable or inaccessible content instead of inventing its contents.

#### Scenario: Unreadable screenshot
- **WHEN** screenshot text cannot be read confidently
- **THEN** the original is retained, uncertainty is shown, and the owner can supply a correction

#### Scenario: Unavailable article
- **WHEN** an article is blocked, requires login, or cannot be fetched
- **THEN** the URL remains saved and the item explains that the article body is unavailable

#### Scenario: Scanned PDF
- **WHEN** an accepted PDF contains no usable text
- **THEN** it is retained for review with the text-extraction limitation shown

### Requirement: Suggested relevance and future use
The system SHALL provide a concise summary and suggested connections or possible uses grounded in source content and known owner context. It SHALL mark uncertain interpretations and SHALL NOT require a current goal or automatically discard material judged irrelevant.

#### Scenario: Interesting but unassigned material
- **WHEN** a saved item has no clear connection to the owner's known priorities
- **THEN** the item remains available in the inbox or open exploration with no invented commitment

### Requirement: Editable organization
The system SHALL support editable areas, topics, optional projects, and multiple connections per item without duplicating the original. The owner SHALL be able to edit summaries and classifications, and later enrichment SHALL preserve explicit corrections.

#### Scenario: One item in two areas
- **WHEN** an article is linked to engineering and entrepreneurship
- **THEN** both views show the same underlying item and corrections are reflected in both

#### Scenario: Correcting an AI label
- **WHEN** the owner removes an incorrect topic and the item is reprocessed
- **THEN** the removed topic is not silently restored

### Requirement: Browse and search the library
The system SHALL provide paginated browsing and search with filters for source type, area, topic, optional project, and processing status. Unprocessed items SHALL remain discoverable by their saved metadata.

#### Scenario: Find a pending article
- **WHEN** the owner searches for the title or URL of a saved article awaiting enrichment
- **THEN** the item appears with its processing state and original URL

### Requirement: Export and deletion
The system SHALL allow export of originals and structured library metadata. Deleting an item SHALL immediately exclude it from new retrieval and suggestions, remove derived content from active storage through tracked cleanup, and disclose backup retention separately.

#### Scenario: Delete during processing
- **WHEN** the owner deletes an item while processing is running
- **THEN** the item is excluded immediately and late job results cannot recreate its content or derived memory

#### Scenario: Export personal material
- **WHEN** the owner requests an export
- **THEN** an authenticated download includes originals, extracted text, organization, and source metadata in documented portable formats

### Requirement: Bounded external content processing
The system SHALL treat source content as data, reject article fetches targeting non-public network destinations, enforce resource limits, and prevent source instructions from modifying permissions or causing unrelated actions.

#### Scenario: Article redirects to a private address
- **WHEN** a submitted URL redirects to an internal network or metadata service
- **THEN** the fetch is refused and the item reports a safe retrieval failure

#### Scenario: Instructions embedded in an article
- **WHEN** an article tells the assistant to reveal secrets or change the owner's preferences
- **THEN** those instructions do not authorize an action or update personal memory
