# Conversation UI: implementation checkpoints

Status: checkpoints 1 and 2 (tasks 3.1–3.2) implement the validated browser client,
session isolation, and a read-only conversation workspace. The owner approved a
monochrome interface with owner messages on the right and Mentor responses on the
left. The owner subsequently approved checkpoint 3a: sending, draft preservation,
delivery reconciliation, and running-attempt polling. SSE attempt retry is now
implemented and verified in tasks 3.3f–3.3g. Clear history and complete
interaction/auth acceptance remain separate follow-ups.
Tasks 3.3–3.5 remain open pending their full implementation and verification.
The owner subsequently approved backend streaming slice 1 (task 2.6). Its opt-in
SSE endpoint is documented in [the conversation guide](conversation-loop.md#backend-streaming-slice-1).
Browser streaming slice 2 is implemented below; full recovery/proxy acceptance
is a separate later slice. The historical checkpoints below describe the
earlier JSON submission and polling behavior.

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

- Add `apps/web/src/features/conversation/api/conversation-api.ts` using the generated
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

## Checkpoint 3a: sending and delivery recovery

The first approved portion of task 3.3 enables the composer when current history
and assistant status permit sending. Enter sends; Shift+Enter adds a newline and
IME composition is left alone. Validate nonblank input and the server's UTF-8
message-byte limit before allocating a UUID. Preserve the exact submitted text,
including surrounding whitespace, when assigning the UUID and observed version.

`ConversationSubmission` owns one in-memory draft and delivery identity. Its
states are editing, sending, uncertain delivery, checking, and stale history.
The small `useConversationSubmission` hook connects it to React and the existing
query adapter. Neither module holds a second transcript or persists browser data.
Known admission rejections preserve editable text. Transport/response failures
and a 15-second confirmation timeout retain the original UUID, version, and text;
editing stays locked until delivery is resolved. There is no automatic POST retry.

Polling or an immediate head read can confirm acceptance by the request ID and
exact text, allowing the composer to clear before the original foreground POST
finishes. Late completion of that POST cannot replace the next draft or produce
an error for a different submission. A missing turn in the current head is not
proof of rejection: it may be outside the page or not yet committed. The explicit
Check or resend action reads fresh history and, if still unresolved, replays the
original request. This is idempotent delivery recovery, separate from retrying a
failed model attempt. Session/history guards remain in the existing query adapter.

`conversation-polling.ts` decides whether the head needs two-second polling;
`useConversationHistory` supplies that policy to TanStack Query with background
polling disabled. Unresolved delivery and persisted running attempts keep it
active, including after reload. A terminal head stops polling. Read failures
retain cached history and never trigger a write. Typing the next draft is allowed
while work runs; admitting the next message waits. The transcript follows new
responses when already near the end and moves to a newly accepted local message;
reading older history and prepending pages preserve the reading position.

Observing a newer history version clears pre-clear draft/key state without replay.
Logout/session replacement unmounts and resets the controller; late responses
remain rejected by the request scope. A page reload restores accepted history,
but deliberately drops unsent in-memory text. No local/session storage is used.

Verified locally on 2026-11-01:

- 17 focused delivery/polling tests cover pending/known-rejected/uncertain input,
  a hung POST, byte validation, exact-payload replay, missing head entries,
  read failures, stale history, session replacement, and late completions.
- `pnpm check` passes formatting, architecture lint, strict types, all 269
  unit/contract tests, generated contracts, and the production build. OpenAPI and
  generated-client output have no drift; strict OpenSpec validation also passes.
- 29 production-browser scenarios cover send/follow-up, Enter/Shift+Enter/IME,
  CSRF, a slow foreground POST, lost or hung responses, explicit same-key
  recovery, busy/unavailable admission, accepted model failure, read failure,
  UTF-8 bytes, stale/cleared history, reload, logout and a submission 401, reading
  position, accepted-message scrolling, phone/desktop layout, no browser storage,
  and the continued absence of the removed footer. The earlier 28 workspace and
  branding regression scenarios also pass with the enabled composer.
- The browser runs the production frontend on a separate local port and
  intercepts every API call with synthetic data. This verifies UI/client behavior;
  it is not an integrated database/cookie/provider acceptance run. No paid model
  call, `.env` change, database migration, or development-data operation occurs.
- Full retry, Clear history, and task 3.4 auth acceptance remain unimplemented or
  unverified as a complete checkpoint. Keep tasks 3.3–3.5 open. Browser artifacts
  and acceptance scripts are under ignored `output/playwright/conversation-ui/`.

## Checkpoint 3: remaining resilient interaction and acceptance (tasks 3.3–3.5)

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
background monitoring, long-term memory, and external actions remain outside
this change. Streaming now has its own approved backend checkpoint, followed by
browser rendering and recovery acceptance; durable token replay remains outside
that scope.

## Checkpoint 3b: browser streaming slice 2 (task 3.3a)

The composer now uses `POST /api/v1/conversation/turns/stream` through the generated
client with its streaming response parser, shared CSRF handling, and existing
session/history request scope. The compatible JSON operation remains available.
`conversation-stream-reader.ts` owns incremental UTF-8/SSE framing, comment
heartbeats, bounded frame parsing, idle timeout, and reader cleanup.
`conversation-stream-contracts.ts` owns runtime event validation checked against
generated component types. `conversation-stream-api.ts` validates event order,
submission identity, attempt/version identity, and final state; server error text
never becomes a user-facing exception message. HTTP chunks are not SSE frames.

`ConversationSubmission` separates admission from stream completion. Acceptance
or a matching head read clears only the submitted draft and stops the 15-second
confirmation wait. The owner can then write the next draft; neither subsequent
acceptance confirmation nor final completion may clear it. Text is held only in
one temporary attempt/version-scoped response, never in query history or browser
storage. Committed admission/result snapshots update the head cache and cancel
older in-flight head reads; terminal saved state supersedes provisional text.
The transcript follows growing text only when already following the latest
content, preserving its existing pagination and reading-position behavior.
Readable run status is announced without making every text fragment a live-region
announcement. Model-attempt retry and Clear history controls are still absent.

History polling is a recovery path. It pauses for a running attempt with a matching
live stream. Uncertain delivery or a running attempt without a live stream uses
foreground two-second polling, including after reload or a running replay.
Disconnect, invalid events, a 30-second absence of any stream bytes, or exceeding
temporary display limits detaches the reader, discards partial text, and reads
saved history. It never automatically replays a POST or cancels admitted backend
execution. Session/history changes discard private local state and gate all late
events; observing a terminal result also detaches any obsolete reader.

Verification on 2026-11-07:

- 32 additional deterministic checks cover stream framing across single-byte UTF-8
  chunks, LF/CRLF/CR, comments and multiline data, delivery before completion,
  identity/order validation, final-state validation, JSON and redacted SSE errors,
  replay, incomplete EOF, frame/idle bounds, session/history cancellation, saved
  snapshot precedence, draft lifetimes, and recovery polling. The existing 17
  delivery tests also pass.
- `pnpm check` passes formatting, architecture lint, strict types, all 317
  unit/contract tests, contract regeneration, and the production build. Strict
  OpenSpec validation and diff whitespace checks pass. Generated API output is
  unchanged; the API-client entrypoint additionally exports generated component
  types for browser contract checking. Build-generated Next.js references are
  restored to their incoming values.
- Synthetic browser checks use a separate production frontend on port 3217 and a
  localhost SSE fixture on port 4317. They verify desktop/phone early text,
  submitted/next-draft behavior, no concurrent Send, saved-final replacement,
  no horizontal overflow or transcript storage, no polling during a healthy live
  stream, dropped-stream polling without duplicate writes, saved completion after
  disconnect, known admission rejection, failure after deltas, reload recovery,
  and logout cleanup. Screenshots were inspected at 1365x900 and 390x844. Scripts,
  server fixture, CLI results, and screenshots remain under ignored
  `output/playwright/conversation-ui/streaming/`.
- The fixture exercises the actual production Next.js rewrite and frontend, but
  replaces authentication, API execution, and persistence with synthetic local
  responses. This is evidence of incremental proxy delivery in this setup, not
  full slice-3 acceptance with real cookies, NestJS, PostgreSQL, or a deployed
  proxy. Database integration was not rerun for this browser-only slice; the
  previous backend checkpoint passed 95 checks. No live model calls, existing
  `.env` edits, or development-data operations occurred.

Stop here for review. Task 3.3 remains open for retry, Clear history, and full
acceptance; task 3.4 and full recovery/proxy acceptance remain open as well.

## Markdown response rendering

Assistant responses now pass through `AssistantContent`, which separates message
layout and attempt state from content rendering. Its `MarkdownContent` renderer
uses react-markdown and remark-gfm for paragraphs, emphasis, headings, lists,
quotes, code, tables, strikethrough, and disabled task checkboxes. Both provisional
streaming text and saved final answers use this renderer; the owner’s input stays
literal text. This supersedes the escaped-text presentation at checkpoint 2.

Typography, spacing, borders, and surfaces use existing brand tokens. Tables and
code blocks scroll independently and accept keyboard focus. Raw HTML is escaped,
generated links render as text, and image syntax renders an alt-text placeholder
without fetching assets. Recorded sources retain their separate validated links.
The renderer accepts incomplete Markdown during streaming; final saved state still
supersedes provisional text through the existing lifecycle.

Future image or interactive responses can be composed at `AssistantContent` after
introducing a validated content-block contract and backend asset/persistence
support. This slice keeps the existing answer-string API and storage unchanged;
it does not implement those future response types or execute generated UI code.

Verification: `pnpm check` passes formatting, lint, strict types, 322 unit/contract
tests (including five new renderer tests), generated-contract checks, and the
production build. Synthetic browser checks at 1365px, 390px, and 320px verify
partial/final formatting, preserved next drafts, literal owner text, inert HTML,
no remote image/link requests, and no page overflow. Wide tables and code blocks
scroll using the keyboard. Desktop and phone screenshots were inspected; ignored
artifacts are under `output/playwright/markdown/`. Database integration was not
rerun for this frontend-only slice. No live model calls or API/storage contract
changes were made.

## Conversation feature organization

`apps/web/src/features/conversation/` keeps the feature together while grouping
files by responsibility:

- `conversation-workspace.tsx` remains the composition entry point.
- `ui/` owns transcript, message, composer, and run-detail presentation.
- `ui/content/` owns `AssistantContent` and Markdown response rendering, with room
  for future validated response types.
- `api/` owns HTTP operations, response/event contracts, error decoding, and SSE
  framing and validation.
- `state/` owns query/cache integration, request scope, submission and draft
  lifecycle, polling decisions, and their React hooks.

This organization changes file locations and imports only. Existing tests remain
under `apps/web/tests/`, and conversation styles remain in `globals.css`.

Reorganization verification: formatting, lint, strict types, all 322 unit/contract
tests, and the production build pass. Comparing the moved modules, workspace, and
existing tests against the Markdown checkpoint confirms that all non-import
source content is unchanged. Database integration and browser acceptance were not
repeated for these file moves.

## Submission readability checkpoint (tasks 3.3b–3.3e)

The refactor keeps the existing browser contract and recovery policy. Read state
and transitions in `state/submission-state.ts`, then effects in
`state/conversation-submission.ts`. The hook and composer continue to consume
`SubmissionSnapshot`. Saved turns belong to Query/PostgreSQL; this state owns
only the draft, unresolved input, notices, and provisional text.

The coordinator holds one immutable state value and a cached UI projection.
`deliveryGeneration` gates obsolete callbacks; it is separate from auth session
generation, server history version, and idempotency request ID. Cancellation and
the confirmation timer remain coordinator resources. `observeHistory` returns
acceptance, terminal-state, and history-replacement facts so the coordinator can
stop confirmation without stopping a healthy reader, or detach it when saved
history settles. Failure classification discards caught message text; policy
distinguishes confirmed acceptance, initial send, and explicit resend. The hook,
composer, query contracts, stream limits, and backend execution remain unchanged.

| Event                                          | State transition                                                        | Coordinator effects                                                             | Behavior tests in `apps/web/tests/`                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Edit or invalid Send                           | Editable draft; invalid input has no request ID                         | Validate blank/UTF-8 length before allocating an ID                             | `conversation-submission.test.ts`: byte validation, exact draft, double Send                          |
| Initial Send                                   | Sending owns the original ID, version, and exact text                   | One POST, confirmation timer, scoped reader                                     | Same file: exact draft, hung POST                                                                     |
| Acceptance by event or matching history        | Return to editing; clear submitted draft once                           | Stop confirmation timer; preserve healthy delivery; publish committed events    | `conversation-stream-submission.test.ts`: next draft, history-confirmed acceptance                    |
| No confirmation or inconclusive resend failure | Uncertain retains original input; editing locked                        | Read head; no automatic POST                                                    | `conversation-submission.test.ts`: lost response, unavailable/BUSY/invalid/403 resend, missing page   |
| Explicit Check or resend                       | Check with original input, then resend only if still unresolved         | Fresh history first; failed check sends nothing; same-key replay                | Same file: failed check, exact payload/count, definitive conflict                                     |
| Known initial rejection or definitive conflict | Editing retains text, drops unresolved identity                         | Refresh head for BUSY                                                           | Same file: rejected draft, resend conflict                                                            |
| Disconnect after acceptance                    | Editing preserves next draft, removes partial text, typed stream notice | Detach reader; read saved state; foreground polling                             | `conversation-stream-submission.test.ts`: broken stream, no automatic resend                          |
| Final result or saved terminal history         | Remove partial text; preserve next draft; clear stream-loss notice      | Publish saved result; terminal history detaches reader                          | Stream submission tests and `conversation-stream.test.ts`: failure/final precedence                   |
| Session/history replacement                    | Drop private draft/input/stream; stale refresh carries no input         | Invalidate delivery generation, stop timer, abort reader; never replay old text | Both submission files and `conversation-scope.test.ts`: late events, obsolete delivery, stale history |
| React reads current state                      | Cached snapshot reference until a state change                          | Notify subscribers on transition                                                | `conversation-submission.test.ts`: external-store snapshot stability                                  |

Before production changes on 2026-11-08, the existing browser suite passed all
108 tests. Added behavior coverage exercises snapshot identity, inconclusive
resend rejection versus definitive conflict, and callbacks from a detached reader
after another send. Existing behavior assertions remain in place. Full project
checks and synthetic browser acceptance will be recorded below after the refactor;
neither database integration nor live-provider verification is part of this
browser-only baseline.

Verification after implementation on 2026-11-08:

- `pnpm check` passes formatting, architecture lint, strict types, all 329
  unit/contract tests, API generation, and the production build. The browser
  portion now has 115 tests, including seven added behaviors/races. The first
  full run hit sandbox `listen EPERM` in the existing SDK localhost-stub suite;
  rerunning with localhost access passed. Generated OpenAPI/client output has
  no drift. Strict OpenSpec validation and diff whitespace checks pass.
- Fourteen synthetic scenarios pass at 1365x900 and 390x844: acceptance/next
  draft, disconnect/saved completion, lost confirmation with same-key resend,
  history-confirmed acceptance without resend, history replacement, logout,
  and expired-session cleanup. Healthy streams do not poll; disconnected ones
  poll and replace partial text with saved output. Recovery preserves the next
  draft. Disconnect uses one POST/one synthetic run; explicit resend uses two
  identical payloads/one synthetic run. Session/history replacement neither
  replays nor restores old content. Browser local/session storage stays empty.
- The browser runs the actual production frontend on port 3247 through its
  Next.js rewrite to a synthetic localhost API/SSE fixture on port 4347. For lost
  confirmation, the fixture commits a synthetic running turn, sends a heartbeat
  but no acceptance, and temporarily omits it from history. This exercises both
  explicit replay and later confirmation by a head read. The initial fixture
  closed before any bytes and triggered transport retry; the completed checks
  use the heartbeat to establish delivery before simulated loss.
- Desktop/phone screenshots were inspected; no page overflow was found.
  Fixture, CLI script/results, scenario counts, and screenshots are under ignored
  `output/playwright/submission-refactor/`. This is frontend/rewrite evidence
  with synthetic authentication, storage, and execution. It does not complete
  real-cookie/NestJS/PostgreSQL/deployed-proxy acceptance. Database integration
  was not rerun because no backend/database behavior changed. No live model
  calls, development-data changes, or `.env` edits were made.

Tasks 3.3b–3.3e finish this review checkpoint. Task 3.3 remains open for explicit
model-attempt retry, Clear history, and full acceptance. Backend refactoring,
reserved tool configuration, query-adapter contract removal, and search remain
separate follow-ups. No commit is created until requested.

## SSE attempt retry (tasks 3.3f–3.3g)

The browser now offers **Retry response** beneath only the newest turn whose
latest attempt failed or was interrupted. Completed and older turns are
ineligible. The action is disabled when status/history is not ready, execution is
unavailable, sign-out is underway, a mutation is unresolved, or an attempt is
running. Synchronous coordinator guards prevent double clicks from allocating
another key. Another client's write can still change eligibility; server
admission is authoritative and rejection refreshes history without changing the
draft or submitting a replacement message.

`submission-state.ts` owns a typed `DeliveryOperation`: send carries the exact
`SubmitInput`; retry carries the target turn ID and exact `RetryInput`. The
existing coordinator owns both operations' HTTP effects, confirmation wait,
reader, and cancellation generation. There is no second coordinator or transcript
store. `SubmissionSnapshot` retains its existing fields and adds
`pendingRetryTurnId` for pending/recovery copy. Only send acceptance clears its
submitted draft; all retry outcomes preserve the independent draft except the
existing session/history replacement policy that clears private state.

`streamRetryConversationTurn` calls the generated POST retry-stream route with
CSRF and validates the requested turn, history version, retry attempt key, and
subsequent event identity. Both streaming operations share the bounded parser and
event reader. The query adapter supplies `retryStream`, scope guards, and saved
cache publication; the hook connects it to the same coordinator. Previous
attempts remain in run details, provisional text stays ephemeral, and saved
terminal snapshots cannot regress to running state.

History acceptance searches the target turn's attempts for the retry key, not the
original message key. An older unsuccessful attempt cannot settle a new retry.
A matching live reader survives history-confirmed acceptance and pauses periodic
polling. Disconnect, invalid events, reload, and running replay use saved history
and two-second foreground polling. The 15-second confirmation wait, 30-second byte
idle timeout, and framing/display bounds remain unchanged. Recovery always checks
fresh history before an explicit same-command resend; failed reads send nothing.
Inconclusive resend rejection retains the original identity. Initial known
rejection and definitive conflicts are handled separately. Session/history and
obsolete-delivery guards suppress late events without automatic replay.

Verification on 2026-11-08:

- `pnpm check` passes formatting, architecture lint, strict types, all 377
  unit/contract tests, generated-contract checks, and the production build. The
  browser portion now has 157 tests, including 42 added retry behaviors and
  identity/race cases. Existing send assertions remain intact.
- `pnpm test:integration` passes all 104 disposable PostgreSQL/HTTP/SDK checks.
  The browser slice changes no backend contract or persistence; generated API
  output has no drift from backend retry commit `04f6c8a`. Strict OpenSpec
  validation and whitespace checks pass.
- Twenty-six synthetic scenarios pass at 1365x900 and 390x844, plus a double-click
  check at each size (28 total). They cover keyboard retry, early/final/failed
  output, retrying interrupted work, fresh keys for later intentional retries,
  current/next-draft preservation, preserved prior attempts, normal sending after
  retry, eligibility/unavailable execution, and another-client eligibility races.
  Healthy streams do not poll; disconnects poll and recover saved completion.
- Lost confirmation retains the exact retry path/body: explicit recovery uses two
  identical POSTs with one synthetic run; failed history checks send nothing.
  History-confirmed acceptance preserves a healthy reader. Invalid stream
  identity, reload, history replacement, logout, and expiry recover or clear
  private state without automatic writes. Both double-click checks record one
  POST, one run, one message, and two attempts. Browser local/session storage
  remains empty, screenshots were inspected, and no page overflow was found.
- The production frontend runs on port 3257 through its Next.js rewrite to a
  localhost API/SSE fixture on port 4357. Authentication, storage, and model work
  in the browser fixture are synthetic; the separate integration suite verifies
  real HTTP/database boundaries. These checks do not complete real-cookie browser
  integration, a deployed proxy, or broad task-3.4 authentication acceptance.
  The eligibility race is injected by the fixture as another client's newer turn.
  No live model calls, `.env` edits, migrations, or development-data changes occur.
- Fixture, browser scripts, machine-readable scenario results, and phone/desktop
  screenshots are under ignored `output/playwright/retry/`. Deliberate 401/409/503
  responses and dropped streams produce expected browser network errors; the
  initial favicon 404 is unrelated to conversation behavior.

Tasks 3.3f–3.3g complete the retry checkpoint. Task 3.3 remains open for Clear
history and its remaining acceptance; investigation remains later work. Stop for
review here. The backend checkpoint is committed as `04f6c8a`. The browser retry checkpoint
is complete and verified; Clear history remains a separate slice.
