export interface ActiveSession {
  owner: { id: string; email: string };
  expiresAt: Date;
  idleExpiresAt: Date;
}

export interface SessionLifetime {
  idleMs: number;
  absoluteMs: number;
}
