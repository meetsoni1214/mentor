import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export async function createApiApplication(
  options: NestApplicationOptions = {},
) {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    ...options,
  });
  app.use(
    (_request: IncomingMessage, response: ServerResponse, next: () => void) => {
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
  );
  app.setGlobalPrefix('api/v1');
  return app;
}
