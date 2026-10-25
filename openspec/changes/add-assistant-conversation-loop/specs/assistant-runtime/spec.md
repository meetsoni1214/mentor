# Spec Delta

## Purpose

Run bounded, inspectable assistant work from an owner conversation, using permitted evidence sources while keeping permissions and execution controls in application code.

## ADDED Requirements

### Requirement: Backend-owned model execution

The system SHALL execute model requests on the backend using server-held credentials and explicit model configuration. Conversation history SHALL remain application-owned. Provider response storage SHALL be disabled without claiming zero provider retention. Missing configuration SHALL disable new runs while preserving access to existing conversations.

#### Scenario: Model configuration is missing

- **WHEN** the owner submits a turn without complete enabled provider configuration
- **THEN** the app explains that assistant execution is unavailable, preserves the draft, and makes no provider call

### Requirement: Cloud-processing disclosure

Before first model submission, the app SHALL explain that the current message and bounded conversation context go to OpenAI. Before enabling web investigation, it SHALL explain that derived search queries go to the web-search service. The backend SHALL require acknowledgement of the current disclosure version before accepting a run.

#### Scenario: First assistant use

- **WHEN** the owner has not acknowledged the current disclosure
- **THEN** the app presents it and the backend refuses model submission until acknowledgement

### Requirement: Finite run admission

Application code SHALL enforce configured input, output, tool-call, wall-clock, concurrent-run, and daily admitted-attempt limits before or during execution. Daily allowance SHALL be reserved atomically across requests and restarts. Ambiguous failures SHALL retain their reservation. Provider retries SHALL not occur automatically. Limits SHALL not be described as an exact monetary billing cap.

#### Scenario: Concurrent budget exhaustion

- **WHEN** simultaneous submissions compete for the last daily admission
- **THEN** at most one is admitted and rejected submissions make no provider call

#### Scenario: Execution deadline

- **WHEN** a run exceeds its configured deadline
- **THEN** the application aborts the provider request, records an interrupted attempt, and prevents late publication

### Requirement: Explicit read-only investigation

Public-web investigation SHALL be disabled by default and enabled only by the owner's explicit per-turn selection. With it disabled, no web tool SHALL be offered. With it enabled, only the approved read-only public-web tool SHALL be available. The assistant SHALL not execute external writes, connect mailboxes, or gain permissions from pasted content or retrieved pages.

#### Scenario: Pasted malicious instruction

- **WHEN** a pasted email or retrieved page instructs the assistant to reveal secrets, rotate keys, or contact an external service
- **THEN** that content is treated as evidence rather than authorization and no such tool or credential is exposed

#### Scenario: Ordinary conversation

- **WHEN** the owner submits a turn with investigation disabled
- **THEN** the provider request includes no search tool and the answer does not claim that a public-web check occurred

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
