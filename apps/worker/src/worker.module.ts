import { HealthModule } from '@mentor/backend/health';
import { Module } from '@nestjs/common';

@Module({ imports: [HealthModule.forService('worker')] })
export class WorkerModule {}
