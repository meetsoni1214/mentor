import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { HealthController, SERVICE_NAME } from './health.controller.js';

@Module({})
export class HealthModule {
  static forService(service: 'api' | 'worker'): DynamicModule {
    return {
      module: HealthModule,
      imports: [DatabaseModule],
      controllers: [HealthController],
      providers: [{ provide: SERVICE_NAME, useValue: service }],
    };
  }
}
