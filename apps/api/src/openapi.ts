import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Mentor API')
      .setDescription(
        'Single-owner authentication and service health. Mutations require Origin and X-CSRF-Token headers.',
      )
      .setVersion('0.0.0')
      .addCookieAuth('mentor-session')
      .build(),
  );
}
