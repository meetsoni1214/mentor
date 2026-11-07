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
- **THEN** those steps belong to the same admitted attempt, use SDK execution behavior and the application deadline, and produce at most one completed answer

#### Scenario: Required SDK controls are unsupported

- **WHEN** the pinned SDK/provider combination or selected model cannot enforce required storage, tracing, retry, cancellation, or limit policies
- **THEN** the integration fails visibly without silently switching provider, API, or policies

### Requirement: Cloud-processing documentation

Documentation SHALL explain that the current message and bounded context go to OpenAI and that permitted public-web search can send derived queries to that service. At the owner's request, the conversation UI SHALL omit the cloud-processing and Privacy & context section beneath the composer. No persisted acknowledgement or acknowledgement gate SHALL be required.

#### Scenario: Focused conversation interface

- **WHEN** the owner opens the conversation
- **THEN** the composer has no cloud-processing or Privacy & context footer, while documentation records cloud processing without requiring a versioned acknowledgement

### Requirement: Standard SDK execution controls

Application code SHALL retain message/initial-transcript bounds, the attempt deadline, and owner concurrency checks. The adapter SHALL use the unmodified pinned SDK Responses model and default runner iteration limit. It SHALL pass the configured output-token setting per model call and SHALL NOT add custom request hooks, complete-request byte enforcement, cumulative token/tool/model-call budgets, or a custom answer-byte cap. Client and SDK automatic retries SHALL remain disabled.

#### Scenario: SDK iteration limit

- **WHEN** the SDK reaches its default iteration limit
- **THEN** the adapter maps its exception to a stable limit failure without publishing a partial answer

#### Scenario: Several model calls

- **WHEN** a test-only tool causes another SDK model call
- **THEN** the same per-call output setting is supplied without deducting earlier usage, and the SDK manages intermediate context

#### Scenario: Application context selection

- **WHEN** a new turn's completed history exceeds the initial transcript limit
- **THEN** the application selects the newest complete pairs that fit, keeps older history browsable, and does not claim that the selected-transcript limit bounds the entire SDK wire payload

#### Scenario: Execution deadline

- **WHEN** the application deadline signal aborts a run
- **THEN** cancellation reaches the SDK and the application records interruption and prevents late publication

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

### Requirement: SDK-reported run usage

The adapter SHALL use the SDK's aggregate usage as provided and SHALL NOT introduce independent budget accounting. SDK normalization of missing provider counts to zero SHALL be documented. When no SDK usage is available, the application SHALL retain null. Missing usage SHALL NOT independently block continuation. Raw SDK state and hidden reasoning SHALL not be persisted.

#### Scenario: Multi-call SDK usage

- **WHEN** the SDK returns usage for several calls
- **THEN** the adapter maps its aggregate counts into the application outcome

#### Scenario: Provider omits usage

- **WHEN** the SDK normalizes missing provider counts to zero
- **THEN** the adapter accepts that SDK behavior without treating the resulting metrics as independently audited provider totals

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

### Requirement: Provisional backend response streaming

Authenticated streaming submission SHALL emit committed admission, provisional text deltas, and a persisted result through application-owned SSE events. JSON submission SHALL remain compatible. Deltas SHALL contain only answer text and attempt/version identity, never raw SDK events or reasoning. Partial text SHALL remain ephemeral; only successful conditional completion SHALL enter durable answer history.

#### Scenario: Text arrives before completion

- **WHEN** the SDK emits answer text while an admitted attempt is running
- **THEN** the stream delivers text deltas before final persistence, and emits the result only after the attempt is conditionally saved

#### Scenario: Streaming request is replayed

- **WHEN** the same submission key and payload are posted again
- **THEN** the stream reports the existing persisted snapshot and closes without attaching to or starting another runner

#### Scenario: Reader disconnects or cannot keep up

- **WHEN** a stream reader disconnects or exceeds bounded output buffering
- **THEN** progress delivery detaches while the original request continues bounded execution and persistence without automatic replay

#### Scenario: Failure after provisional text

- **WHEN** the provider fails, the deadline expires, or history is cleared after deltas were emitted
- **THEN** no partial text becomes a completed answer, late deltas stop, and connected readers receive a persisted unsuccessful result or redacted stream error

#### Scenario: Rejected streaming admission

- **WHEN** session, Origin, CSRF, input, version, or concurrency checks reject streaming submission
- **THEN** the normal JSON HTTP error is returned before SSE headers and no additional runner starts
