import { ConversationLoop } from '@mentor/backend/conversation';
import type {
  Admission,
  ConversationTurn,
  RunAttempt,
} from '@mentor/backend/conversation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../../../identity/adapters/driving/http/auth-http.service.js';
import { ApiErrorDto } from '../../../../identity/adapters/driving/http/auth.dto.js';
import {
  AssistantStatusDto,
  ConversationErrorDto,
  ConversationHistoryDto,
  HistoryVersionDto,
  RetryTurnDto,
  SubmitTurnDto,
  TurnResultDto,
} from './conversation.dto.js';
import type { ConversationTurnDto, RunAttemptDto } from './conversation.dto.js';
import { parseHistoryQuery, requireJson } from './conversation.validation.js';

function ownerId(request: AuthenticatedRequest): string {
  if (!request.authSession) throw new UnauthorizedException();
  return request.authSession.owner.id;
}

function describeTurn(turn: ConversationTurn): ConversationTurnDto {
  return {
    id: turn.id,
    requestId: turn.requestId,
    sequence: turn.sequence,
    text: turn.text,
    createdAt: turn.createdAt.toISOString(),
  };
}

function describeAttempt(attempt: RunAttempt): RunAttemptDto {
  return {
    id: attempt.id,
    turnId: attempt.turnId,
    requestId: attempt.requestId,
    attemptNumber: attempt.attemptNumber,
    model: attempt.model,
    state: attempt.state,
    startedAt: attempt.startedAt.toISOString(),
    deadlineAt: attempt.deadlineAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
    answer: attempt.answer,
    errorCode: attempt.errorCode,
    sources: attempt.sources.map(({ title, url }) => ({ title, url })),
    activity: attempt.activity.map(({ type, status }) => ({ type, status })),
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    contextLimited: attempt.contextLimited,
  };
}

function describeResult(result: Admission): TurnResultDto {
  return {
    historyVersion: result.historyVersion,
    turn: describeTurn(result.turn),
    attempt: describeAttempt(result.attempt),
  };
}

@ApiTags('assistant')
@ApiCookieAuth()
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 500, type: ApiErrorDto })
@Controller('assistant')
export class AssistantController {
  constructor(
    @Inject(ConversationLoop)
    private readonly conversation: ConversationLoop,
  ) {}

  @Get('status')
  @ApiOkResponse({ type: AssistantStatusDto })
  status(): AssistantStatusDto {
    return this.conversation.status();
  }
}

@ApiTags('conversation')
@ApiCookieAuth()
@ApiExtraModels(ApiErrorDto, ConversationErrorDto)
@ApiResponse({
  status: 400,
  schema: {
    anyOf: [
      { $ref: getSchemaPath(ConversationErrorDto) },
      { $ref: getSchemaPath(ApiErrorDto) },
    ],
  },
  description:
    'INVALID_INPUT for conversation validation; BAD_REQUEST for malformed JSON.',
})
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 404, type: ConversationErrorDto })
@ApiResponse({ status: 409, type: ConversationErrorDto })
@ApiResponse({ status: 413, type: ApiErrorDto })
@ApiResponse({ status: 415, type: ApiErrorDto })
@ApiResponse({ status: 500, type: ApiErrorDto })
@ApiResponse({ status: 503, type: ConversationErrorDto })
@Controller('conversation')
export class ConversationController {
  constructor(
    @Inject(ConversationLoop)
    private readonly conversation: ConversationLoop,
  ) {}

  @Get()
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'integer',
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: 'historyVersion',
    required: false,
    type: 'integer',
    minimum: 0,
    description: 'Required together with beforeSequence.',
  })
  @ApiQuery({
    name: 'beforeSequence',
    required: false,
    type: 'integer',
    minimum: 1,
    description: 'Use nextCursor from the previous page.',
  })
  @ApiOkResponse({ type: ConversationHistoryDto })
  async history(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<ConversationHistoryDto> {
    const history = await this.conversation.history(
      ownerId(request),
      parseHistoryQuery(query),
    );
    return {
      historyVersion: history.historyVersion,
      nextCursor: history.nextCursor,
      turns: history.turns.map((turn) => ({
        ...describeTurn(turn),
        attempts: turn.attempts.map(describeAttempt),
      })),
    };
  }

  @Post('turns')
  @HttpCode(200)
  @ApiBody({ type: SubmitTurnDto })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({
    type: TurnResultDto,
    description:
      'Terminal attempt, or current persisted state on replay. No automatic retry.',
  })
  async submit(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<TurnResultDto> {
    requireJson(request);
    return describeResult(
      await this.conversation.submit(ownerId(request), body),
    );
  }

  @Post('turns/:turnId/retry')
  @HttpCode(200)
  @ApiParam({ name: 'turnId', format: 'uuid' })
  @ApiBody({ type: RetryTurnDto })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: TurnResultDto })
  async retry(
    @Req() request: AuthenticatedRequest,
    @Param('turnId') turnId: string,
    @Body() body: unknown,
  ): Promise<TurnResultDto> {
    requireJson(request);
    return describeResult(
      await this.conversation.retry(ownerId(request), turnId, body),
    );
  }

  @Delete('history')
  @HttpCode(200)
  @ApiBody({ type: HistoryVersionDto })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: HistoryVersionDto })
  async clear(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<HistoryVersionDto> {
    requireJson(request);
    return {
      historyVersion: await this.conversation.clear(ownerId(request), body),
    };
  }
}
