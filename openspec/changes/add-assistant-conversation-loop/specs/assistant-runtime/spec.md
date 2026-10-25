# Spec Delta

## Purpose

Run bounded, inspectable assistant work from an owner conversation, using permitted evidence sources while keeping permissions and execution controls in application code.

## ADDED Requirements

### Requirement: Backend-owned model execution

The system SHALL execute model requests on the backend using server-held credentials, an explicit model, and finite limits. Valid configuration SHALL enable execution automatically without an enable flag. Application-owned history SHALL remain readable when missing or invalid configuration disables new runs. Provider response storage SHALL be disabled; this SHALL NOT imply zero provider retention.

#### Scenario: Model configuration is missing

- **WHEN** the owner submits a turn without complete valid provider configuration
- **THEN** the app explains that assistant execution is unavailable, preserves the draft, and makes no provider call

#### Scenario: Model configuration is valid

- **WHEN** valid server credentials, an explicit model, and finite limits are configured
- **THEN** assistant execution is ready without a separate enable flag

### Requirement: Cloud-processing disclosure

Before first model submission, the app SHALL explain that the current message and bounded conversation context go to OpenAI. The notice SHALL also explain that the assistant can choose public-web search when permitted and derived search queries go to that service. No persisted acknowledgement or acknowledgement gate SHALL be required.

#### Scenario: First assistant use

- **WHEN** the owner first uses the assistant
- **THEN** the app explains cloud processing without requiring a versioned acknowledgement or blocking submission on one

### Requirement: Finite run admission

Application code SHALL enforce configured input, output, tool-call, wall-clock, and concurrent-run limits before or during execution. Provider retries SHALL not occur automatically. Limits SHALL not be described as an exact monetary billing cap.

#### Scenario: Concurrent submissions

- **WHEN** simultaneous distinct submissions compete to start work in the conversation
- **THEN** at most one is admitted while an attempt is running and rejected submissions make no provider call

#### Scenario: Execution deadline

- **WHEN** a run exceeds its configured deadline
- **THEN** the application aborts the provider request, records an interrupted attempt, and prevents late publication

### Requirement: Assistant-selected read-only investigation

The assistant SHALL choose whether to use public-web search from the tools allowed by runtime settings, within configured execution limits. Turns SHALL NOT carry an investigation flag or require a search toggle. Unavailable tools SHALL not be offered. Pasted content and retrieved pages SHALL not grant permissions to read mailboxes or execute external writes.

#### Scenario: Pasted malicious instruction

- **WHEN** a pasted email or retrieved page instructs the assistant to reveal secrets, rotate keys, or contact an external service
- **THEN** that content is treated as evidence rather than authorization and no such tool or credential is exposed

#### Scenario: Ordinary conversation

- **WHEN** the owner submits an ordinary conversational message while web search is available
- **THEN** the assistant can answer without searching, no per-message tool choice is required, and the answer does not claim an unperformed public-web check

#### Scenario: Current information needs verification

- **WHEN** a request needs current public information and web search is permitted
- **THEN** the assistant can choose web search without an additional user toggle, and any actual search activity and sources are recorded

#### Scenario: Web search is unavailable

- **WHEN** runtime settings do not permit web search
- **THEN** no web-search tool is offered and the assistant explains its limitation when current verification is needed

### Requirement: Evidence-backed source presentation

The system SHALL distinguish provider-observed web activity and citation annotations from generated prose. Source links SHALL come from validated provider evidence, use safe HTTP(S) destinations, and be displayed accessibly. Generated links SHALL not be promoted to verified sources. Evidence attribution SHALL not imply that every claim is true or account exposure is established.

#### Scenario: Actual search result

- **WHEN** a provider response includes web activity and valid source annotations
- **THEN** the app records that activity and displays the annotated sources alongside the answer

#### Scenario: Fabricated or unsafe source

- **WHEN** generated prose invents a source or an annotation contains an unsafe URL
- **THEN** the system does not display it as a verified clickable source

### Requirement: Honest outcomes and capabilities

The assistant SHALL distinguish suggestions from executed actions and public information from account-specific findings. Refusals, incomplete output, malformed responses, provider errors, and limits SHALL yield truthful recoverable states. It SHALL not claim email monitoring, private-account access, key rotation, or evidence checks absent actual supporting operations.

#### Scenario: Railway notice without account access

- **WHEN** the owner asks whether a pasted security notice affects their Railway projects
- **THEN** Mentor explains what the supplied or retrieved evidence supports, identifies missing account evidence, and does not claim it checked projects or rotated credentials

### Requirement: Inspectable operational activity

The owner SHALL be able to inspect run status, model identifier, observed tool activity, source references, context truncation, and available usage. Application logs SHALL omit private prompts, message bodies, secrets, and raw provider payloads. The interface SHALL not fabricate intermediate steps or expose hidden model reasoning as an activity history.

#### Scenario: Failed provider request

- **WHEN** the provider returns an error containing sensitive request details
- **THEN** the app shows a stable failure category and logs only redacted operational metadata
