export interface ConversationActivityReader {
  startFreshContext(ownerId: string): Promise<void>;
  hasUnexpiredRunningAttempt(ownerId: string): Promise<boolean>;
}
