export const AUTH_HTTP_CONFIG = Symbol('AUTH_HTTP_CONFIG');

export interface AuthHttpConfig {
  APP_ORIGIN: string;
  SESSION_ABSOLUTE_SECONDS: number;
  secureCookies: boolean;
}
