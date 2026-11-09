import { PersonalMemory } from '@mentor/backend/memory';
import { DatabaseModule, DatabaseService } from '@mentor/backend/database/nest';
import { Module } from '@nestjs/common';
import { MemoryController } from '../adapters/driving/http/memory.controller.js';
import { createPersonalMemory } from './create-personal-memory.js';

@Module({
  imports: [DatabaseModule],
  controllers: [MemoryController],
  providers: [
    {
      provide: PersonalMemory,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        createPersonalMemory(database.db),
    },
  ],
})
export class MemoryModule {}
