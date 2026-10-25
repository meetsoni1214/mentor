import 'reflect-metadata';
import {
  readDatabaseEnvironment,
  readServiceEnvironment,
} from '@mentor/backend/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  readDatabaseEnvironment();
  const environment = readServiceEnvironment();
  const app = await NestFactory.create(WorkerModule, { abortOnError: false });
  app.enableShutdownHooks();
  // This listener keeps the worker shell observable; job processors arrive later.
  await app.listen(environment.WORKER_PORT, environment.HOST);
  Logger.log(
    `Worker shell listening on port ${environment.WORKER_PORT}; no jobs registered`,
    'Bootstrap',
  );
}

bootstrap().catch(() => {
  Logger.error(
    'Worker startup failed. Check environment configuration and port availability.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
