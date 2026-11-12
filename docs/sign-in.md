# Sign-in and sessions

## Run locally

Start PostgreSQL and apply migrations with `pnpm db:migrate`. If the owner does
not exist, run `pnpm owner:create`. Start `pnpm dev` and open
**https://mentor.localhost**, or the full URL Portless prints for a worktree.
Sign in with the provisioned credentials to open the conversation workspace.

`pnpm dev` supplies Portless's public URL as `APP_ORIGIN`. For direct development,
`pnpm dev:direct` defaults to **http://127.0.0.1:3000**; the browser address must
match the configured origin exactly. Paths and trailing slashes are not accepted.
`API_INTERNAL_URL` is the separate internal destination of the frontend proxy.
See [development](development.md#portless-local-https) for HTTPS setup.

## Follow a login

`apps/api/src/identity/infrastructure/identity.module.ts` constructs the shared
`Sessions` use case and registers authentication's controller and global guard.
It validates runtime configuration once and supplies it through Nest providers.
The HTTP service receives the use case and cookie/Origin settings; it does not
construct database or crypto adapters. See [identity boundaries](identity-architecture.md)
for the full module map.

1. `apps/web/src/features/auth/auth-screen.tsx` requests the current session.
   A 401 shows the login form; network/server failures show a retry state.
2. `login-form.tsx` collects credentials. Passwords stay out of query caches,
   browser storage, URLs, and logs. A successful request clears the form.
3. `auth-api.ts` obtains a CSRF token and submits JSON credentials using the
   OpenAPI-generated client. Next.js proxies `/api/v1/*` to NestJS.
4. `apps/api/src/identity/adapters/driving/http/access.guard.ts` checks the exact browser Origin and
   CSRF signature for mutations, including login. Login is explicitly public;
   other API routes require a database session unless marked public.
5. `auth.controller.ts` validates credentials, then invokes the shared `Sessions`
   use case in `packages/backend/src/identity/application/sessions.ts`.
6. The database atomically reserves one login attempt. The use case verifies
   Argon2id even when the email does not match, and uses the same error response
   for invalid credentials. No owner also performs a dummy hash verification.
7. A successful login generates a fresh 256-bit token. Only its SHA-256 hash is
   stored in PostgreSQL; the raw token goes into an HttpOnly session cookie.
   A previous session from the same browser is revoked in the creation transaction.
8. The response includes only the owner ID, email, and expiry timestamps. The
   frontend validates the response and updates its session query.

## Session lifecycle

- Defaults: 30 minutes idle and 24 hours absolute lifetime. Configure
  `SESSION_IDLE_SECONDS` and `SESSION_ABSOLUTE_SECONDS`; idle cannot exceed absolute.
- Authenticated requests atomically check both deadlines and advance last activity.
  The absolute deadline never moves. Concurrent requests cannot move activity backwards.
- Reloading the page restores the session from its cookie and database record.
  No periodic keep-alive is sent. The UI rechecks at the idle deadline and when
  the browser regains focus; the API always enforces expiration independently.
- Logout deletes the database session before clearing the cookie. The frontend
  cancels in-flight queries and removes other cached data on explicit logout.
  Other tabs detect logout on their next session check or protected request.
- Expired sessions are rejected immediately and are cleaned up on successful login.
- Administrative password recovery uses `pnpm owner:reset-password`; it replaces
  the password and revokes all sessions atomically. See [owner setup](owner-setup.md).

## Request protections

Mutation requests require an exact configured Origin and an HMAC CSRF token bound
to a browser nonce and its current session token. The nonce is in an HttpOnly
cookie; the CSRF response provides the signature to the frontend. The API creates
the signing key at startup. The frontend fetches a fresh signature before every
mutation, including logout, so an API restart is recoverable without signing out.
This key lifecycle currently assumes one API process; replicas would need shared
key configuration or a shared synchronizer-token store.

Session and nonce cookies use `Path=/`, HttpOnly, and SameSite=Strict without a
Domain attribute. HTTPS origins also use Secure cookies with the `__Host-` prefix.
Production configuration requires an explicit HTTPS `APP_ORIGIN`. Development
HTTP origins are allowed only on loopback. Cookies are not scoped to ports, so
do not run untrusted services on the same development hostname.

There is no permissive CORS configuration or trust in forwarded client IP headers.
The single-owner login budget is global: five well-formed attempts per fifteen
minutes, counting successful logins too. It survives API restarts and returns 429
with `Retry-After` when exhausted. This simple limit can temporarily block the
owner if another client consumes the budget; deployment-level rate limiting is
still needed before public hosting.

All API responses use private/no-store caching. The exception filter returns
fixed error messages and omits raw exceptions, SQL parameters, hashes, and cookies.
Health checks and development API documentation contain no owner account data.

The design follows [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
and [session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
Local integration checks exercise these controls. HTTPS deployment and reverse-proxy
behavior still need verification on the eventual deployment target.

## API contract

| Method | Path                   | Purpose                                    |
| ------ | ---------------------- | ------------------------------------------ |
| GET    | `/api/v1/auth/csrf`    | Obtain a CSRF signature and nonce cookie   |
| POST   | `/api/v1/auth/login`   | Verify credentials and establish a session |
| GET    | `/api/v1/auth/session` | Read the authenticated owner and expiry    |
| POST   | `/api/v1/auth/logout`  | Revoke the current session                 |

POST requests require `Origin` and `X-CSRF-Token`; login accepts JSON only. The
browser supplies Origin. Login and session responses share a generated type.
No signup or password-reset endpoint exists.

## Verification

`pnpm test:integration` exercises actual cookies/CSRF, session-token hashing,
rotation, logout, idle/absolute expiry, concurrent activity/login attempts,
password-reset races/rollback, API restart persistence, and HTTP validation against
disposable PostgreSQL. HTTPS-origin cases verify Secure and `__Host-` cookie
headers without establishing TLS transport behavior.

Local integrated phone/desktop acceptance covers sign-in, reload restoration,
logout/session expiry during conversation work, private-state cleanup, and empty
browser local/session storage. See [conversation verification](conversation-loop.md#verification).
Firefox, WebKit, real devices, and deployed HTTPS/reverse-proxy behavior remain
unverified.
