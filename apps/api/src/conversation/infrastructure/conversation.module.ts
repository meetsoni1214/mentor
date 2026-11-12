import { ConversationLoop } from '@mentor/backend/conversation';
import { OpenAIConversationModel } from '@mentor/backend/conversation/model';
import { DrizzleConversationRepository } from '@mentor/backend/conversation/persistence';
import { readAIEnvironment } from '@mentor/backend/config/ai';
import type { AIEnvironment } from '@mentor/backend/config/ai';
import type { DatabaseConnection } from '@mentor/backend/database';
import { DatabaseModule, DatabaseService } from '@mentor/backend/database/nest';
import { Module } from '@nestjs/common';
import { createPersonalMemory } from '../../memory/infrastructure/create-personal-memory.js';
import {
  AssistantController,
  ConversationController,
} from '../adapters/driving/http/conversation.controller.js';

import { ConversationStreamService } from '../adapters/driving/http/conversation-stream.service.js';

// Transport overrides are trusted composition inputs for local contract tests,
// never environment settings or request parameters.
export function createConversationLoop(
  db: DatabaseConnection['db'],
  configuration: AIEnvironment,
  transport: ConstructorParameters<typeof OpenAIConversationModel>[1] = {},
): ConversationLoop {
  const memory = createPersonalMemory(db);
  return new ConversationLoop(
    new DrizzleConversationRepository(db),
    configuration.enabled
      ? {
          enabled: true,
          limits: configuration.limits,
          model: new OpenAIConversationModel(configuration.apiKey, transport),
        }
      : { enabled: false },
    undefined,
    {
      read: async (ownerId) => {
        const profile = await memory.list(ownerId);
        return profile.entries.map((entry) => entry.text);
      },
    },
  );
}

@Module({
  imports: [DatabaseModule],
  controllers: [AssistantController, ConversationController],
  providers: [
    ConversationStreamService,
    {
      provide: ConversationLoop,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        createConversationLoop(database.db, readAIEnvironment()),
    },
  ],
  exports: [ConversationLoop],
})
export class ConversationModule {}
