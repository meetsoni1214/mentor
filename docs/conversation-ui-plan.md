# Conversation UI: implementation checkpoints

Status: checkpoints 1 and 2 (tasks 3.1–3.2) implement the validated browser client,
session isolation, and a read-only conversation workspace. The owner approved a
monochrome interface with owner messages on the right and Mentor responses on the
left. Sending stays separate and disabled. Checkpoint 3 requires later approval;
reliable submission and complete interaction acceptance are not implemented.

## Starting point before checkpoint 1

`apps/web/src/features/auth/auth-screen.tsx` restores the session, renders the
signed-in placeholder, and handles logout. It already cancels queries and removes
other cached data when replacing a session. It does not yet handle conversation
requests, private drafts, or all late mutation responses. The existing
`auth-api.ts` has a sign-in-specific error class and private CSRF helper.

TanStack Query and Zod are already web dependencies. `@mentor/api-client` exposes
the generated paths and a same-origin client; Next.js forwards `/api/*` to NestJS.
The five conversation/status endpoints are available. There is no need to change
the backend contract or introduce a second conversation store for this UI.

## Checkpoint 1: validated client and session isolation (task 3.1)

Implement only this checkpoint first, then stop for review.

- Add `apps/web/src/features/conversation/conversation-api.ts` using the generated
  client for status, paginated history, submit, retry, and clearing. Validate
  responses with browser-owned Zod schemas; do not import backend code or edit
  generated types. Preserve stable error codes, versions, attempt states, and
  request keys. Send JSON/CSRF through the existing same-origin proxy.
- Extract the small CSRF/protected-request behavior shared with authentication.
  Keep sign-in credential errors distinct from an expired protected session and
  assistant failures. Do not add a general service framework.
- Centralize session-loss cleanup so a protected 401 cancels private requests,
  removes private queries, and returns to sign-in. An old request must not expire
  or populate a newer signed-in session. The caller must also be able to reject
  results from an obsolete history version after clearing.
- Keep the current screen until the next checkpoint. This slice establishes the
  browser data boundary; it does not claim a working conversation experience.

Use controllable/deferred HTTP fakes to verify valid and malformed responses,
assistant-specific errors, CSRF failures, cancellation, and late results after
logout, sign-in replacement, session expiry, or a history-version change. Verify
that mutations do not automatically create fresh attempts. Existing sign-in and
logout behavior must still pass its checks. Use focused tests and relevant gates;
reserve full conversation browser acceptance for the complete interaction slice.

## Checkpoint 1 implementation and usage

`features/auth/session-state.ts` owns one `SessionState` per QueryClient, obtained
with `sessionStateFor(queryClient)`. The existing screen uses it for restoration,
sign-in, and logout. A session replacement or protected 401 rotates its request
scope, aborts pending requests, cancels/removes private queries, clears mutation
cache entries, and publishes the new session (or null for sign-in recovery).
Generation checks also reject results when a transport ignores cancellation.
Credential 401s remain sign-in errors; CSRF 403s do not expire the session.
`features/auth/session-scope.ts` exposes the `SessionScope` interface and
`ObsoleteSessionError`. Conversation depends on this contract; the caller supplies
`sessionState.scope()` without exposing authentication or cleanup methods.

The browser conversation boundary has five focused modules:

| Module                      | Responsibility                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `conversation-contracts.ts` | Browser-owned Zod schemas, inferred response types, and generated request-type aliases                                |
| `conversation-errors.ts`    | Assistant error decoding and fixed local messages                                                                     |
| `conversation-api.ts`       | Stateless generated-client HTTP operations, fresh CSRF tokens, response validation, and request/result correspondence |
| `conversation-scope.ts`     | Current-session/history checks and cancellation; no HTTP calls or query-cache operations                              |
| `conversation-queries.ts`   | Session-scoped query keys/options and removal of obsolete conversation cache entries                                  |

Create one `createConversationQueries(sessionState.scope(), queryClient)` for the current
signed-in workspace and share it across reads and mutations. Recreate it after
session replacement. The adapter composes the existing protected session scope,
a conversation scope, and the HTTP functions. The scope remembers only the
observed history version and cancellation state; TanStack Query owns cached data.
The stateless HTTP functions can also be exercised without either scope or cache,
but protected UI operations must go through the composed adapter.

Use `conversation.historyOptions(options)` and `conversation.statusOptions()`
with TanStack Query. These set generated keys, forward cancellation, and disable
query retries. Keys include a local session generation number (never a credential),
and older-page keys include the server history version. For example:

```ts
const conversation = createConversationQueries(
  sessionState.scope(),
  queryClient,
);
const history = await queryClient.fetchQuery(conversation.historyOptions());
```

When a head read discovers a newer version, the request scope rejects obsolete
work. The query adapter removes old pages and other obsolete history queries,
while preserving the query delivering the new version and already-current pages.
A successful clear similarly removes obsolete history. Both operations retain
assistant status and unrelated feature queries/mutations; only mutations keyed
under `conversation.keys.all` are removed. Use that prefix for future conversation
mutations. Session loss still clears all private state through `SessionState`.

A stale server response exposes `STALE_HISTORY`; the interaction slice must load
current history without resubmitting old input. Call
`conversation.assertCurrent(result.historyVersion)` immediately before manual
cache writes or mutation callbacks, especially after additional asynchronous work.
Old adapter references reject requests after session replacement. Requests use
no-store and preserve caller request IDs. The client generates no submission keys,
performs no automatic mutation retry or replay, and writes no transcript or draft
to browser storage. Keep future mutation retries explicitly disabled; uncertain
writes must retain their key.

Deterministic verification is in `apps/web/tests/conversation-api.test.ts`. The
real generated HTTP client uses a controllable fetch fake with synthetic data.
Checks cover response shapes and state invariants, error codes, JSON/CSRF,
cancellation, no automatic mutation replay, and late success/401 responses after
logout, session replacement/expiry, and clearing (including a pending initial
history read). Real TanStack Query caches verify private queries and mutation
success callbacks cannot restore obsolete content. Scope-only tests in
`apps/web/tests/conversation-scope.test.ts` verify version and session races without
HTTP. The regression test exercises an actual cached head refetch that discovers
a newer history version while an older page is pending; the new head completes
and is cached, while stale pages disappear and unrelated state survives.
Full interaction and provider acceptance remain checkpoint 3 and group 4.

Verified locally on 2026-11-01:

- `pnpm check` passed: formatting, architecture lint, strict type checks, generated
  contracts, all 252 tests (including 54 frontend checks), and the production
  build. The SDK stub needs the permitted execution path to bind localhost.
  Regeneration produced no OpenAPI/client drift.
- The subsequent public `SessionScope` extraction passed all 54 frontend checks,
  `pnpm lint`, `pnpm typecheck`, formatting, and the frontend production build.
  Conversation imports the contract without depending on `SessionState`.
- A Chromium smoke check against the production frontend on a separate local
  port used browser-intercepted synthetic auth responses. Invalid credentials
  displayed the existing error; successful sign-in and reload restored the
  placeholder; logout at 390×844 returned to the form with empty inputs. Browser
  local/session storage were empty and the phone screen had no horizontal overflow.
  This earlier checkpoint smoke check covers the existing auth wiring, not real
  cookies, database authentication, or the future conversation screen. It was not
  repeated for the subsequent conversation-only refactor.
- Database integration checks were not rerun for this browser-only slice. No live
  OpenAI calls were made. Full conversation/browser acceptance remains open.

## Checkpoint 2: readable conversation workspace (task 3.2)

Replace the signed-in placeholder with one continuous transcript opened after
sign-in. Include older-message pagination, an accessible composer, empty/loading/
configuration-disabled/error states, and expandable run details. Keep per-response
limited-context notes; the owner removed the cloud-processing/privacy footer.
Cloud-processing information remains in documentation. Display answer
text safely; production search remains unavailable and empty activity must not
be presented as a completed search.

Use white, black, and neutral gray with readable typography. The owner replaced
the earlier green direction with a focused monochrome interface. Owner messages
align right in dark bubbles and Mentor replies align left in light bubbles. The
main layout is a writing workspace with the transcript and composer as its focus,
account controls nearby, and Clear history in privacy settings in its later slice. There is no
thread sidebar, title editor, or New conversation flow. Review the phone/desktop
composition, keyboard navigation, focus behavior, and status announcements.

This checkpoint establishes rendering and client integration. Submission,
reconciliation, retry, and clearing become fully operational and accepted in the
next checkpoint; do not leave an apparently working Send control that silently
drops text. The owner approved keeping sending separate: both the textarea and
Send button are disabled with “Sending is not available yet.” No draft is accepted.

Shared branding and control styles are documented in
[the design system guide](design-system.md). The brand name/metadata, reusable
logo/lockup, and semantic color/typography/spacing tokens live under
`apps/web/src/brand/`. Sign-in and conversation controls use local shadcn
primitives for buttons, inputs, labels, textareas, alerts, and collapsible run
details. Tailwind utilities consume the shared brand tokens. Focus, disabled,
keyboard, and reduced-motion behavior remain part of this checkpoint.

## Checkpoint 2 implementation and verification

After sign-in, `AuthScreen` renders `ConversationWorkspace`, keyed by the local
session generation. The workspace creates one query adapter and shares it across
history and assistant-status reads. Session replacement unmounts local workspace
state along with the existing private-cache cleanup. There are no mock transcripts
or synthetic answers in application code.

| Module                        | Responsibility                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `conversation-workspace.tsx`  | Workspace composition, header/logout, assistant availability, shared query adapter         |
| `use-conversation-history.ts` | Head and cursor-page queries, current-version filtering, ordering and deduplication        |
| `conversation-transcript.tsx` | Loading/empty/error states, older-page recovery, scroll and keyboard-focus preservation    |
| `conversation-message.tsx`    | Right/left bubbles, latest attempt outcome, escaped answer text and limited-context notice |
| `run-details.tsx`             | Expandable persisted attempts, model, context, activity, sources, and nullable SDK usage   |
| `conversation-composer.tsx`   | Explicitly disabled composer with its availability explanation                             |

Initial history opens at the latest messages. Older pages prepend without moving
the visible message; pagination returns keyboard focus to that reading position.
Page failures retain loaded messages and offer an explicit retry. Head refreshes
that observe a newer history version discard the old page list. Running attempts
show their persisted state with a manual “Check for updates” action. Automatic
polling, submission, retry attempts, and history clearing remain checkpoint 3.
Answers are escaped text, preserving whitespace without rendering HTML or turning
generated URLs into links. Recorded sources use the already-validated contract.

Verification uses the production frontend at a separate local port with every API
request intercepted by Playwright and supplied synthetic data. It does not use real
cookies, the development database, provider credentials, or paid model calls.
Browser checks cover:

- Loading, empty history, initial errors and recovery, older-page failure/retry,
  readable history with execution disabled, and completed/failed/interrupted/running states.
- Right/left alignment, disabled input/sending, run details operated by keyboard,
  null versus zero usage, ordered pagination without duplicates, scroll/focus
  preservation, and replacement of old pages after a newer history version.
- Escaped HTML-like answer text, long unbroken content,
  visible composer and no horizontal overflow at 1440×1000, 390×844, and 320×568.
- Reduced motion, logout removing the transcript, subsequent sign-in restoring the
  workspace, empty browser local/session storage, and no conversation mutations.

`pnpm check` passes formatting, lint, strict types, all 252 unit/contract tests,
generated-contract checks, and the production build. This slice adds browser
verification rather than duplicating the existing request-boundary unit tests.
The owner subsequently removed the OpenAI processing line and Privacy & context
footer section. The section and its CSS have been removed; the updated production
browser checks assert that both are absent. The shared-brand follow-up also
verifies metadata and sign-in branding, default native button types, and changing
one primary token across the logo, primary controls, outgoing bubbles, and focus
rings while neutral body text stays unchanged. Pagination, keyboard, error,
disabled-sending, and phone/desktop checks were repeated after this refactor.
Screenshots and local browser artifacts are under ignored
`output/playwright/conversation-ui/`. Full sending/recovery acceptance, real-cookie
authentication acceptance, integration reruns, and live-provider verification are
not claimed by this UI checkpoint.

## Checkpoint 3: resilient interaction and acceptance (tasks 3.3–3.5)

Wire submission with one UUID retained until acceptance/rejection is known. Keep
unsent text in memory on failed admission. A lost response retains the original
key for reconciliation through history or matching replay; a fresh key must not
be generated merely because the network failed. Explicit retry creates a new
attempt on the latest eligible turn and has its own replay key.

Poll history while an attempt is running. Refresh restores accepted work from
the database without resubmitting; an unsent in-memory draft need not survive
refresh. Add deliberate Clear history with the observed version, discard old
pages, and reject late pre-clear results. On stale-history errors reload current
state without resending old input. Logout or session expiry clears private
queries/drafts and prevents late responses from repopulating them. Store no
transcript or draft in local/session storage.

Verify behavior with synthetic providers on phone and desktop:

| Scenario                                               | Required result                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Contextual follow-up, return another day, change topic | Same continuous transcript; no creation/selection step                     |
| History beyond model context                           | Older messages remain browsable; limited context is disclosed              |
| Reload while running or lose a POST response           | Restore/reconcile accepted state without duplicate input or another runner |
| Busy, disabled execution, temporary API failure        | Explain the state and preserve the unsent draft                            |
| Failed/interrupted attempt                             | Honest status; explicit eligible retry starts a fresh attempt              |
| Clear during generation or from another tab            | New version replaces local content; old results/replays cannot restore it  |
| Session expiry/logout during requests                  | Sign-in recovery clears private state and never auto-resubmits             |
| Keyboard, announcements, phone/desktop                 | Usable focus, readable run status, and no horizontal overflow              |

Record the actual browser evidence and limitations in `docs/conversation-loop.md`,
run the relevant checks, and present the complete group-3 checkpoint for review.
Fixture output must be identified as synthetic. Live model quality and public-web
investigation remain separate group-4 work.

## After the UI

Group 4 adds only permitted hosted public-web search, observed activity and safe
source presentation, adversarial fixtures, and complete-loop acceptance. The
opt-in live smoke check is separate from deterministic verification. Email sync,
background monitoring, long-term memory, streaming, and external actions remain
outside this change.
