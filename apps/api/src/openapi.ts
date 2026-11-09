import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Mentor API')
      .setDescription(
        'Single-owner authentication, continuous assistant conversation, explicit personal memory, and service health. Mutations require Origin and X-CSRF-Token headers. Conversation endpoints execute in the foreground; GET requests and memory operations never start model work.',
      )
      .setVersion('0.0.0')
      .addCookieAuth('mentor-session')
      .build(),
  );
}
