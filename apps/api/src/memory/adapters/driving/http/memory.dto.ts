import { ApiProperty } from '@nestjs/swagger';

export class SaveMemoryDto {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({
    maxLength: 1024,
    description:
      'Start with Remember that (case insensitive) and one space, then nonblank wording. At most 1024 UTF-8 bytes overall, 512 bytes after trimming payload boundary whitespace. The original request is retained as source.',
  })
  sourceRequest!: string;
}

export class MemoryLimitsDto {
  @ApiProperty({ enum: [20] }) maxEntries!: number;
  @ApiProperty({ enum: [512] }) maxEntryBytes!: number;
  @ApiProperty({ enum: [4096] }) maxProfileBytes!: number;
  @ApiProperty({ enum: [1024] }) maxRequestBytes!: number;
}

export class MemoryEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ description: 'Owner wording, at most 512 UTF-8 bytes.' })
  text!: string;
  @ApiProperty({
    description: 'Original direct owner request, at most 1024 UTF-8 bytes.',
  })
  sourceRequest!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class MemorySnapshotDto {
  @ApiProperty({ type: MemoryLimitsDto }) limits!: MemoryLimitsDto;
  @ApiProperty({ type: [MemoryEntryDto] }) entries!: MemoryEntryDto[];
}

export class MemoryErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty({
    enum: [
      'INVALID_INPUT',
      'NOT_FOUND',
      'IDEMPOTENCY_CONFLICT',
      'BUSY',
      'LIMIT_EXCEEDED',
    ],
  })
  code!: string;
  @ApiProperty() message!: string;
}
