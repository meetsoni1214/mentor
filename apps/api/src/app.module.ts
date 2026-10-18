import { DatabaseModule, HealthModule } from '@mentor/backend';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthHttpService } from './identity/auth-http.service.js';
import { AuthController } from './identity/auth.controller.js';
import { AccessGuard } from './identity/access.guard.js';
import { HttpErrorFilter } from './http-error.filter.js';

@Module({
  imports: [DatabaseModule, HealthModule.forService('api')],
  controllers: [AuthController],
  providers: [
    AuthHttpService,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
