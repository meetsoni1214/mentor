import {
  Argon2PasswordHasher,
  RandomSessionTokens,
} from '@mentor/backend/identity/crypto';
import { DatabaseModule, DatabaseService } from '@mentor/backend/database/nest';
import { DrizzleSessionRepository } from '@mentor/backend/identity/persistence';
import { Sessions } from '@mentor/backend/identity';
import { readAuthEnvironment } from '@mentor/backend/config';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from '../adapters/driving/http/access.guard.js';
import { AuthController } from '../adapters/driving/http/auth.controller.js';
import { AuthHttpService } from '../adapters/driving/http/auth-http.service.js';
import { AUTH_HTTP_CONFIG } from '../adapters/driving/http/auth-http.config.js';

type IdentityConfiguration = ReturnType<typeof readAuthEnvironment>;

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_HTTP_CONFIG, useFactory: readAuthEnvironment },
    {
      provide: Sessions,
      inject: [DatabaseService, AUTH_HTTP_CONFIG],
      useFactory: (database: DatabaseService, config: IdentityConfiguration) =>
        new Sessions(
          new DrizzleSessionRepository(database.db),
          new Argon2PasswordHasher(),
          new RandomSessionTokens(),
          {
            idleMs: config.SESSION_IDLE_SECONDS * 1000,
            absoluteMs: config.SESSION_ABSOLUTE_SECONDS * 1000,
          },
        ),
    },
    AuthHttpService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class IdentityModule {}
