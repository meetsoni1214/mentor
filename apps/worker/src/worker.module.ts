import { HealthModule } from '@mentor/backend';
import { Module } from '@nestjs/common';

@Module({ imports: [HealthModule.forService('worker')] })
export class WorkerModule {}
