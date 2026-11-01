export class ObsoleteSessionError extends Error {
  constructor() {
    super('This request belongs to a previous session.');
  }
}

export interface SessionScope {
  readonly generation: number;
  assertCurrent(): void;
  run<T>(
    request: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}
