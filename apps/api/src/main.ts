import 'reflect-metadata';
import {
  readDatabaseEnvironment,
  readServiceEnvironment,
} from '@mentor/backend/config';
import { Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApiDocument } from './openapi.js';
import { createApiApplication } from './create-application.js';

async function bootstrap() {
  readDatabaseEnvironment();
  const environment = readServiceEnvironment();
  const app = await createApiApplication();
  app.enableShutdownHooks();
  if (environment.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, createOpenApiDocument(app));
  }
  await app.listen(environment.API_PORT, environment.HOST);
  Logger.log(`API listening on port ${environment.API_PORT}`, 'Bootstrap');
}

bootstrap().catch(() => {
  Logger.error(
    'API startup failed. Check environment configuration and port availability.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
