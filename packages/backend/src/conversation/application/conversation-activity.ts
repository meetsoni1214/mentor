import type { ConversationActivityReader } from './ports/conversation-activity.reader.js';

export class ConversationActivity {
  constructor(private readonly reader: ConversationActivityReader) {}

  hasRunningAttempt(ownerId: string): Promise<boolean> {
    return this.reader.hasUnexpiredRunningAttempt(ownerId);
  }
}
