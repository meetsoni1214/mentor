import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DatabaseService,
  Argon2PasswordHasher,
  DrizzleSessionRepository,
  RandomSessionTokens,
  Sessions,
  readAuthEnvironment,
} from '@mentor/backend';
import type { ActiveSession } from '@mentor/backend';
import { Inject, Injectable } from '@nestjs/common';

export interface AuthenticatedRequest extends IncomingMessage {
  authSession?: ActiveSession;
}

@Injectable()
export class AuthHttpService {
  readonly config = readAuthEnvironment();
  readonly sessions: Sessions;
  private readonly csrfSecret = randomBytes(32);
  private readonly sessionCookie = `${this.config.secureCookies ? '__Host-' : ''}mentor-session`;
  private readonly csrfCookie = `${this.config.secureCookies ? '__Host-' : ''}mentor-csrf`;

  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.sessions = new Sessions(
      new DrizzleSessionRepository(database.db),
      new Argon2PasswordHasher(),
      new RandomSessionTokens(),
      {
        idleMs: this.config.SESSION_IDLE_SECONDS * 1000,
        absoluteMs: this.config.SESSION_ABSOLUTE_SECONDS * 1000,
      },
    );
  }

  private cookie(request: IncomingMessage, name: string): string | null {
    const matches = (request.headers.cookie ?? '')
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value.startsWith(`${name}=`));
    if (matches.length !== 1) return null;
    const value = matches[0]?.slice(name.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }

  sessionToken(request: IncomingMessage): string | null {
    return this.cookie(request, this.sessionCookie);
  }

  private setCookie(
    response: ServerResponse,
    name: string,
    value: string,
    maxAge: number,
  ) {
    response.appendHeader(
      'Set-Cookie',
      `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.config.secureCookies ? '; Secure' : ''}`,
    );
  }

  setSession(response: ServerResponse, token: string) {
    this.setCookie(
      response,
      this.sessionCookie,
      token,
      this.config.SESSION_ABSOLUTE_SECONDS,
    );
  }

  clearSession(response: ServerResponse) {
    this.setCookie(response, this.sessionCookie, '', 0);
  }

  private csrfSignature(nonce: string, sessionToken: string | null) {
    return createHmac('sha256', this.csrfSecret)
      .update(`${nonce}:${sessionToken ?? ''}`)
      .digest('hex');
  }

  issueCsrf(request: IncomingMessage, response: ServerResponse): string {
    const nonce =
      this.cookie(request, this.csrfCookie) ?? randomBytes(32).toString('hex');
    this.setCookie(
      response,
      this.csrfCookie,
      nonce,
      this.config.SESSION_ABSOLUTE_SECONDS,
    );
    return this.csrfSignature(nonce, this.sessionToken(request));
  }

  validMutation(request: IncomingMessage): boolean {
    if (request.headers.origin !== this.config.APP_ORIGIN) return false;
    const nonce = this.cookie(request, this.csrfCookie);
    const token = request.headers['x-csrf-token'];
    if (!nonce || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      return false;
    return timingSafeEqual(
      Buffer.from(token, 'hex'),
      Buffer.from(this.csrfSignature(nonce, this.sessionToken(request)), 'hex'),
    );
  }
}
