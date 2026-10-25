import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  readDatabaseEnvironment,
  readServiceEnvironment,
} from '@mentor/backend/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './openapi.js';

async function bootstrap() {
  readDatabaseEnvironment();
  const environment = readServiceEnvironment();
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.use(
    (_request: IncomingMessage, response: ServerResponse, next: () => void) => {
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
  );
  app.setGlobalPrefix('api/v1');
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
