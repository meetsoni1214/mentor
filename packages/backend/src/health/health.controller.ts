import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseService } from '../database/nest.js';
import { PublicRoute } from '../http/public-route.js';

export const SERVICE_NAME = Symbol('SERVICE_NAME');

const healthResponseSchema = {
  type: 'object',
  required: ['status', 'service'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    service: { type: 'string', enum: ['api', 'worker'] },
  },
};

@ApiTags('health')
@PublicRoute()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SERVICE_NAME) private readonly service: 'api' | 'worker',
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: healthResponseSchema })
  live() {
    return { status: 'ok' as const, service: this.service };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: healthResponseSchema })
  @ApiServiceUnavailableResponse({
    description: 'Database unavailable or migrations missing',
  })
  async ready() {
    try {
      await this.database.checkReady();
    } catch {
      throw new ServiceUnavailableException(
        'Database unavailable or migrations missing',
      );
    }
    return this.live();
  }
}
