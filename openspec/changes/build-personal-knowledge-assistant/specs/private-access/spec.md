# Spec Delta

## Purpose

Protect the owner's personal library, conversations, and assistant controls in a privately hosted application.

## ADDED Requirements

### Requirement: Single owner access
The system SHALL allow only the provisioned owner to sign in and SHALL NOT provide public account registration.

#### Scenario: Owner signs in
- **WHEN** the owner supplies valid credentials
- **THEN** the application establishes a session and opens the owner's workspace

#### Scenario: Public account creation
- **WHEN** an unauthenticated visitor attempts to register
- **THEN** the application offers no public registration flow and creates no account

### Requirement: Protected personal resources
The system SHALL enforce authentication and ownership on all content, source files, search results, conversations, memory, exports, and assistant settings.

#### Scenario: Direct source access without a session
- **WHEN** a visitor requests a known source-file URL without a valid session
- **THEN** access is denied without returning file content or personal metadata

### Requirement: Revocable sessions
The system SHALL support session expiration, logout, and revocation of all sessions through an owner credential reset.

#### Scenario: Logged out browser
- **WHEN** the owner logs out and that browser requests a protected resource
- **THEN** the request is denied and signing in is required

#### Scenario: Credential reset
- **WHEN** the operator resets the owner's credentials
- **THEN** all existing sessions lose access

### Requirement: Login abuse resistance
The system SHALL throttle repeated failed authentication attempts and return generic failures that do not disclose credentials or account details.

#### Scenario: Repeated failed login
- **WHEN** failed login attempts exceed the configured threshold
- **THEN** further attempts are temporarily limited and the response discloses no private account information

### Requirement: Cloud processing disclosure
The system SHALL explain before the first AI submission that relevant saved content is processed by the configured cloud provider and SHALL keep provider credentials inaccessible to the browser and model context.

#### Scenario: First AI-assisted capture
- **WHEN** the owner first uses AI processing
- **THEN** the application identifies the provider and content categories sent for processing before submitting the content

### Requirement: Responsive private workspace
The system SHALL support capture, recall, library browsing, personal-memory correction, and suggestion controls on phone and desktop viewports with keyboard-accessible controls and visible processing and error states.

#### Scenario: Capture from a phone
- **WHEN** the owner attaches a supported screenshot from a narrow viewport
- **THEN** the capture control, submission status, and resulting item remain usable without horizontal page scrolling

#### Scenario: Recoverable UI failure
- **WHEN** a request fails while the owner is composing a message
- **THEN** the application preserves the draft and offers an explicit retry
