export interface ConversationActivityReader {
  hasUnexpiredRunningAttempt(ownerId: string): Promise<boolean>;
}
