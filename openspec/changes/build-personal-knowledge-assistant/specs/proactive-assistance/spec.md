# Spec Delta

## Purpose

Prepare and surface useful connections and next steps while protecting the owner's attention and keeping commitments under their control.

## ADDED Requirements

### Requirement: Quiet background preparation
The system SHALL process accepted material and prepare relevant suggestions while the app is closed. It SHALL surface a suggestion only when it has supporting context and an explanation of its usefulness, while allowing an empty suggestions inbox when nothing merits attention.

#### Scenario: No useful new connection
- **WHEN** a background review finds no meaningful new information or action
- **THEN** no proactive message is generated solely to fill a scheduled slot

#### Scenario: Useful connection between saved items
- **WHEN** new material materially connects to an existing interest or commitment
- **THEN** a suggestion can be prepared with links to its evidence and a reason it could be useful

### Requirement: Control interruptions
The owner SHALL control whether proactive assistance is enabled, quiet hours, timezone, and the frequency limit for unsolicited in-app prompts. Non-urgent suggestions SHALL remain in an inbox when interruption is disallowed.

#### Scenario: Quiet hours
- **WHEN** a non-urgent suggestion becomes available during quiet hours
- **THEN** it is saved without interrupting the owner

#### Scenario: Assistance disabled
- **WHEN** the owner disables proactive assistance
- **THEN** unsolicited suggestions and prompts stop while capture and recall continue

### Requirement: Avoid repeated suggestions
The system SHALL support useful, dismiss, snooze, and mute-topic feedback and SHALL deduplicate suggestions across reviews. Dismissed suggestions SHALL not reappear without materially new evidence; silence SHALL not be treated as confirmation or loss of interest.

#### Scenario: Repeated review of unchanged evidence
- **WHEN** the next review encounters a dismissed suggestion's unchanged evidence
- **THEN** that suggestion is not presented again

#### Scenario: Snoozed suggestion
- **WHEN** the owner snoozes a suggestion until a chosen time
- **THEN** it is not surfaced before that time and is rechecked for relevance afterward

### Requirement: Explicit commitments and reminders
The system SHALL create a commitment or reminder only after the owner explicitly requests or confirms it. Reminder details SHALL include the action, due time, timezone, and any recurrence, and SHALL be editable and cancellable.

#### Scenario: Ambiguous timing
- **WHEN** the owner requests a reminder without enough information to determine its due time
- **THEN** the assistant requests clarification before scheduling it

#### Scenario: Confirmed reminder
- **WHEN** the owner confirms a reminder with a specific time
- **THEN** the system records it and produces one due event per scheduled occurrence

### Requirement: Honest delivery behavior
The first version SHALL deliver proactive suggestions and reminder events through the in-app inbox and optional in-app prompts. It SHALL explain that email, operating-system push, and messaging-app delivery are unavailable, and SHALL show missed due events on the next visit without a burst of duplicate prompts.

#### Scenario: Reminder becomes due while the app is closed
- **WHEN** a reminder is due without an active client
- **THEN** its event is retained for the next visit and the system does not claim an external notification was sent

### Requirement: Stop obsolete work
The system SHALL cancel or suppress pending suggestions and reminder occurrences when supporting items are deleted, commitments become inactive, or the owner revokes the relevant reminder.

#### Scenario: Canceled reminder races with delivery
- **WHEN** a reminder is canceled before delivery while its due job is running
- **THEN** delivery rechecks its state and does not present the canceled reminder

### Requirement: Explain and review proactive behavior
The owner SHALL be able to inspect why a suggestion was shown, its supporting material, and relevant feedback or timing controls. Optional scheduled reflections SHALL require enabling a cadence and SHALL not manufacture goals from saved interests.

#### Scenario: Weekly reflection is not enabled
- **WHEN** the owner has not enabled a weekly reflection
- **THEN** the assistant does not impose a weekly review or treat its absence as a missed commitment
