export interface SessionTokens {
  generate(): string;
  digest(token: string): string;
}
