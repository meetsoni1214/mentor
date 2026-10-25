# Spec Delta

## Purpose

Run bounded, inspectable assistant work from an owner conversation, using permitted evidence sources while keeping permissions and execution controls in application code.

## ADDED Requirements

### Requirement: Backend-owned model execution

The system SHALL execute model requests on the backend using server-held credentials, an explicit model, and finite limits. Valid configuration SHALL enable execution automatically without an enable flag. Application-owned history SHALL remain readable and clearable when missing or invalid configuration disables new runs. Provider response storage SHALL be disabled on every underlying model request; this SHALL NOT imply zero provider retention.

#### Scenario: Model configuration is missing

- **WHEN** the owner submits a turn without complete valid provider configuration
- **THEN** the app explains that assistant execution is unavailable, preserves the draft, and makes no provider call

#### Scenario: Model configuration is valid

- **WHEN** valid server credentials, an explicit model, and finite limits are configured
- **THEN** assistant execution is ready without a separate enable flag

### Requirement: Application-controlled Agents SDK execution

The system SHALL use the TypeScript OpenAI Agents SDK with Responses and one Mentor agent per admitted attempt. Application code SHALL own authentication, admission, permissions, limits, persistence, and publication. SDK types SHALL remain within adapters. Only permitted read-only tools SHALL be registered; specialist handoffs, MCP, durable background execution, and resumable approvals are outside this change.

#### Scenario: Several model steps for one request

- **WHEN** a permitted SDK run requires more than one model step
- **THEN** those steps belong to the same admitted attempt, share its execution limits, and produce at most one completed answer

#### Scenario: Required SDK controls are unsupported

- **WHEN** the pinned SDK/provider combination or selected model cannot enforce required storage, tracing, retry, cancellation, or limit policies
- **THEN** the integration fails visibly without silently switching provider, API, or policies

### Requirement: Cloud-processing disclosure

Before first model submission, the app SHALL explain that the current message and bounded conversation context go to OpenAI. The notice SHALL also explain that the assistant can choose public-web search when permitted and derived search queries go to that service. No persisted acknowledgement or acknowledgement gate SHALL be required.

#### Scenario: First assistant use

- **WHEN** the owner first uses the assistant
- **THEN** the app explains cloud processing without requiring a versioned acknowledgement or blocking submission on one

### Requirement: Finite run admission

Application code SHALL bound input, total output, model/tool calls, wall-clock time, and concurrency. Call and output allowances SHALL be shared across SDK iterations. Each outgoing input, including instructions and required intermediate items, SHALL fit its serialized byte limit. SDK and client provider retries SHALL be disabled. These limits SHALL not be described as an exact monetary cap.

#### Scenario: Concurrent submissions

- **WHEN** simultaneous distinct submissions compete to start work in the conversation
- **THEN** at most one is admitted while an attempt is running and rejected submissions make no provider call

#### Scenario: Execution deadline

- **WHEN** a run exceeds its configured deadline
- **THEN** the application aborts the provider request, records an interrupted attempt, and prevents late publication

#### Scenario: Budget exhausted between model steps

- **WHEN** a run has exhausted its model-call or output allowance, or another step cannot fit its required input within the configured bound
- **THEN** no further model call starts, a stable limit-exceeded failure is recorded, and partial output is not published as a completed answer

#### Scenario: Hosted tool allowance is exhausted

- **WHEN** observed hosted tool activity has consumed the run's tool allowance
- **THEN** subsequent requests offer no tools and the allowance is not reset by another SDK iteration

#### Scenario: Usage cannot establish a remaining allowance

- **WHEN** a model step returns missing or malformed usage required to establish the remaining output allowance
- **THEN** no additional model call starts, unknown usage is not counted as zero, and incomplete usage totals remain explicitly unavailable

#### Scenario: Cancellation between model steps

- **WHEN** the attempt is cancelled or its deadline elapses before the next SDK step
- **THEN** no new model or tool operation starts, and late SDK completion cannot publish an answer

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

### Requirement: Aggregate run usage

Available usage SHALL be aggregated across actual model calls, including unsuccessful attempts where known. Unknown totals SHALL remain nullable rather than being replaced with zero or a partial sum presented as a complete total. Intermediate SDK state SHALL not be persisted as hidden reasoning or raw run payloads.

#### Scenario: Multi-call run usage

- **WHEN** an attempt contains several model calls with complete usage records
- **THEN** its reported input/output usage includes all those calls rather than only the final answer's call

### Requirement: Explicit SDK tracing privacy

The system SHALL explicitly disable SDK tracing and automatic trace export initially, independently of provider response storage settings. Local observability SHALL be limited to redacted operational metadata and validated usage/activity/source records. Default execution and tests SHALL not transmit trace payloads to external collectors. Enabling external tracing SHALL require a separate privacy and disclosure decision.

#### Scenario: Ordinary run and shutdown

- **WHEN** a run completes, fails, or is cancelled and the SDK performs cleanup or shutdown
- **THEN** no trace/export request transmits prompts, outputs, tool payloads, secrets, or hidden reasoning

### Requirement: Deterministic SDK contract verification

Ordinary adapter verification SHALL exercise the real Agents SDK and Responses provider against a local HTTP stub with non-stub outbound traffic denied or intercepted. It SHALL verify actual request parameters, call counts, outcomes, and trace/export behavior without live credentials or paid API calls. Synthetic tools used to test SDK iteration SHALL remain test-only.

#### Scenario: Stubbed SDK execution

- **WHEN** the adapter contract suite runs with synthetic inputs
- **THEN** model requests reach only the local stub, storage and retry policies are asserted on the actual requests, and unexpected model or telemetry traffic fails verification
