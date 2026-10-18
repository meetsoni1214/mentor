import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { createOpenApiDocument } from './openapi.js';

// Exporting the contract must not require credentials or a running database.
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
process.env.APP_ORIGIN = 'https://contract.example';
const app = await NestFactory.create(AppModule, {
  logger: false,
  abortOnError: false,
});
try {
  app.setGlobalPrefix('api/v1');
  const output = new URL(
    '../../../packages/api-client/openapi.json',
    import.meta.url,
  );
  await writeFile(
    output,
    `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`,
  );
} finally {
  await app.close();
}
