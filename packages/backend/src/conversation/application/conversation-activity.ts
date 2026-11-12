import type { ConversationActivityReader } from './ports/conversation-activity.reader.js';

export class ConversationActivity {
  constructor(private readonly reader: ConversationActivityReader) {}

  startFreshContext(ownerId: string): Promise<void> {
    return this.reader.startFreshContext(ownerId);
  }

  hasRunningAttempt(ownerId: string): Promise<boolean> {
    return this.reader.hasUnexpiredRunningAttempt(ownerId);
  }
}
