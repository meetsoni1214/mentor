import type { SessionScope } from '../auth/session-scope';

export class ObsoleteHistoryError extends Error {
  constructor() {
    super('This result belongs to an obsolete history version.');
  }
}

// Holds request validity only; transcript data and query caches live elsewhere.
export class ConversationScope {
  private historyVersion: number | null = null;
  private historyGeneration = new AbortController();

  constructor(private readonly session: SessionScope) {}

  assertCurrent(version?: number) {
    this.session.assertCurrent();
    if (
      version !== undefined &&
      this.historyVersion !== null &&
      version !== this.historyVersion
    ) {
      throw new ObsoleteHistoryError();
    }
  }

  async run<T extends { historyVersion: number }>(
    request: (signal: AbortSignal) => Promise<T>,
    expectedVersion?: number,
    signal?: AbortSignal,
  ): Promise<{ value: T; historyChanged: boolean }> {
    this.assertCurrent(expectedVersion);
    if (this.historyVersion === null && expectedVersion !== undefined) {
      this.historyVersion = expectedVersion;
    }
    const combined = AbortSignal.any([
      this.historyGeneration.signal,
      ...(signal ? [signal] : []),
    ]);
    const value = await this.session.run(request, combined);
    this.assertCurrent(expectedVersion);
    combined.throwIfAborted();
    if (
      this.historyVersion !== null &&
      value.historyVersion < this.historyVersion
    ) {
      throw new ObsoleteHistoryError();
    }
    const historyChanged =
      this.historyVersion !== null &&
      value.historyVersion > this.historyVersion;
    if (historyChanged) {
      this.historyGeneration.abort(new ObsoleteHistoryError());
      this.historyGeneration = new AbortController();
    }
    this.historyVersion = value.historyVersion;
    return { value, historyChanged };
  }
}
