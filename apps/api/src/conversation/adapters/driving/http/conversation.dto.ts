import { ApiProperty } from '@nestjs/swagger';

export class AssistantLimitsDto {
  @ApiProperty() model!: string;
  @ApiProperty({ minimum: 1 }) maxMessageBytes!: number;
  @ApiProperty({
    minimum: 1,
    description:
      'Initial transcript bound; excludes SDK overhead and intermediate items.',
  })
  maxContextBytes!: number;
  @ApiProperty({
    minimum: 1,
    description: 'Output-token setting per model call.',
  })
  maxOutputTokens!: number;
  @ApiProperty({ minimum: 1 }) deadlineMs!: number;
}

export class AssistantStatusDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: AssistantLimitsDto, nullable: true })
  limits!: AssistantLimitsDto | null;
}

export class HistoryVersionDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  historyVersion!: number;
}

export class SubmitTurnDto extends HistoryVersionDto {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({
    minLength: 1,
    description:
      'Nonblank text, bounded by the configured UTF-8 message limit.',
  })
  text!: string;
}

export class RetryTurnDto extends HistoryVersionDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'A fresh key for an explicit retry; reuse to reconcile that retry.',
  })
  requestId!: string;
}

export class SourceDto {
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'uri' }) url!: string;
}

export class ActivityDto {
  @ApiProperty({ enum: ['web_search'] }) type!: 'web_search';
  @ApiProperty({ enum: ['completed', 'failed'] }) status!:
    'completed' | 'failed';
}

export class RunAttemptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) turnId!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) attemptNumber!: number;
  @ApiProperty() model!: string;
  @ApiProperty({ enum: ['running', 'completed', 'failed', 'interrupted'] })
  state!: 'running' | 'completed' | 'failed' | 'interrupted';
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ format: 'date-time' }) deadlineAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) answer!: string | null;
  @ApiProperty({
    type: String,
    enum: [
      'PROVIDER_ERROR',
      'REFUSED',
      'INCOMPLETE',
      'INVALID_RESPONSE',
      'RATE_LIMITED',
      'LIMIT_EXCEEDED',
      'INTERRUPTED',
    ],
    nullable: true,
  })
  errorCode!: string | null;
  @ApiProperty({ type: [SourceDto] }) sources!: SourceDto[];
  @ApiProperty({ type: [ActivityDto] }) activity!: ActivityDto[];
  @ApiProperty({ type: 'integer', minimum: 0, nullable: true }) inputTokens!:
    number | null;
  @ApiProperty({ type: 'integer', minimum: 0, nullable: true }) outputTokens!:
    number | null;
  @ApiProperty() contextLimited!: boolean;
}

export class ConversationTurnDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) sequence!: number;
  @ApiProperty() text!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class HistoryTurnDto extends ConversationTurnDto {
  @ApiProperty({ type: [RunAttemptDto] }) attempts!: RunAttemptDto[];
}

export class HistoryCursorDto extends HistoryVersionDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  beforeSequence!: number;
}

export class ConversationHistoryDto extends HistoryVersionDto {
  @ApiProperty({ type: [HistoryTurnDto] }) turns!: HistoryTurnDto[];
  @ApiProperty({ type: HistoryCursorDto, nullable: true })
  nextCursor!: HistoryCursorDto | null;
}

export class TurnResultDto extends HistoryVersionDto {
  @ApiProperty({ type: ConversationTurnDto }) turn!: ConversationTurnDto;
  @ApiProperty({ type: RunAttemptDto }) attempt!: RunAttemptDto;
}

export class ConversationAcceptedEventDto extends TurnResultDto {
  @ApiProperty({ enum: ['accepted'] }) type!: 'accepted';
  @ApiProperty({
    description:
      'A replay reports saved state without attaching to a live run.',
  })
  replayed!: boolean;
}

export class ConversationAttemptEventDto extends HistoryVersionDto {
  @ApiProperty({ format: 'uuid' }) turnId!: string;
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
}

export class ConversationTextDeltaEventDto extends ConversationAttemptEventDto {
  @ApiProperty({ enum: ['text_delta'] }) type!: 'text_delta';
  @ApiProperty({
    description: 'Provisional answer text; never saved as context.',
  })
  delta!: string;
}

export class ConversationResultEventDto extends TurnResultDto {
  @ApiProperty({ enum: ['result'] }) type!: 'result';
}

export class ConversationStreamErrorEventDto extends ConversationAttemptEventDto {
  @ApiProperty({ enum: ['error'] }) type!: 'error';
  @ApiProperty({ enum: ['STALE_HISTORY', 'INTERNAL_ERROR'] }) code!:
    'STALE_HISTORY' | 'INTERNAL_ERROR';
  @ApiProperty() message!: string;
}

export type ConversationStreamEventDto =
  | ConversationAcceptedEventDto
  | ConversationTextDeltaEventDto
  | ConversationResultEventDto
  | ConversationStreamErrorEventDto;

export class ConversationErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty({
    enum: [
      'EXECUTION_UNAVAILABLE',
      'NOT_FOUND',
      'INVALID_INPUT',
      'STALE_HISTORY',
      'IDEMPOTENCY_CONFLICT',
      'BUSY',
      'NOT_RETRYABLE',
    ],
  })
  code!: string;
  @ApiProperty() message!: string;
}
