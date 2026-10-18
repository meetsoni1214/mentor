# Proposal

## Why

Personal notes, screenshots, and articles accumulate faster than they can be organized or recalled. Build a private assistant that connects this material to its owner's evolving interests and commitments, while using the project to learn how reliable AI assistants are built.

## What Changes

- Create a privately hosted, single-owner web app with responsive chat, a browsable library, editable personal memory, and an in-app suggestions inbox.
- Capture text notes, screenshots/images, article URLs, and text-based PDFs; preserve originals and show processing status and recoverable failures.
- Use a cloud AI API to summarize, classify, and suggest potential future uses, with links to supporting sources and explicit uncertainty.
- Organize one library through multiple editable area/topic/project connections. Support exploration without requiring goals or converting saved interests into commitments.
- Answer conversational questions using saved material and source references; distinguish library-supported answers from general model suggestions.
- Quietly prepare useful connections and suggestions, suppress repetition, respect timing controls, and require explicit confirmation before creating commitments or recurring reminders.
- Add private access, durable background processing, export/deletion, operational checks, and documented learning milestones.
- Include a root AGENTS.md during implementation, as requested by the owner.

The first demonstrable milestone is authenticated capture of a note or screenshot followed by source-backed retrieval in a later conversation. The complete first version also includes article/PDF ingestion, editable personal memory, and controlled proactive suggestions.

Out of scope: public registration, shared workspaces, native mobile apps, audio/video ingestion, arbitrary browser or shell agents, external-app actions, purchases, medical or relationship decision-making on the owner's behalf, and training a foundation model. Unsupported files remain an explicit limitation rather than an implied promise to accept everything.

## Capabilities

### New Capabilities

- `private-access`: Single-owner authentication, protected content, and session lifecycle.
- `knowledge-library`: Durable capture, background enrichment, organization, correction, export, and deletion.
- `personal-memory`: Inspectable understanding of the owner, provenance, uncertainty, and distinctions between interests, intentions, and commitments.
- `conversational-recall`: Persistent chat and grounded retrieval with verifiable source references.
- `proactive-assistance`: Quiet background suggestions, contextual resurfacing, explicit reminders, and interruption controls.

### Modified Capabilities

None. The project has no existing capability specifications or application code.

## Impact

- New Next.js frontend and NestJS backend, using TypeScript, Drizzle, and PostgreSQL.
- New private source-file storage, background worker, OpenAI integration, and authenticated API contracts with email-and-password access for one owner.
- New data handling for personal content, model requests, citations, memory, and notification preferences; source content sent to the cloud model must be scoped and disclosed.
- New development tooling, migrations, verification, deployment/backup documentation, and learning notes. Hosting vendor, configured OpenAI model IDs, and spending limits remain explicit deployment settings.
- This change creates planning artifacts first. Implementation begins only after the owner reviews the plan and requests that it be applied.
