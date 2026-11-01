import { HealthModule } from '@mentor/backend/health';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { IdentityModule } from './identity/infrastructure/identity.module.js';
import { HttpErrorFilter } from './http-error.filter.js';
import { ConversationModule } from './conversation/infrastructure/conversation.module.js';

@Module({
  imports: [IdentityModule, ConversationModule, HealthModule.forService('api')],
  providers: [{ provide: APP_FILTER, useClass: HttpErrorFilter }],
})
export class AppModule {}
