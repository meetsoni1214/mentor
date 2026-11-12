import { PersonalMemory } from '@mentor/backend/memory';
import {
  Body,
  Patch,
  Delete,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../../../identity/adapters/driving/http/auth-http.service.js';
import { ApiErrorDto } from '../../../../identity/adapters/driving/http/auth.dto.js';
import {
  MemoryErrorDto,
  EditMemoryDto,
  ForgetMemoryDto,
  ForgottenMemoryDto,
  MemoryEntryDto,
  MemorySnapshotDto,
  SaveMemoryDto,
} from './memory.dto.js';
import {
  describeMemoryEntry,
  describeMemoryRecord,
  describeForgottenMemory,
} from './memory.presenter.js';

function ownerId(request: AuthenticatedRequest): string {
  if (!request.authSession) throw new UnauthorizedException();
  return request.authSession.owner.id;
}

@ApiTags('memory')
@ApiCookieAuth()
@ApiExtraModels(MemoryErrorDto, ApiErrorDto, MemoryEntryDto, ForgottenMemoryDto)
@ApiResponse({
  status: 400,
  schema: {
    anyOf: [
      { $ref: getSchemaPath(MemoryErrorDto) },
      { $ref: getSchemaPath(ApiErrorDto) },
    ],
  },
})
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 404, type: MemoryErrorDto })
@ApiResponse({ status: 409, type: MemoryErrorDto })
@ApiResponse({ status: 410, type: MemoryErrorDto })
@ApiResponse({ status: 413, type: ApiErrorDto })
@ApiResponse({ status: 415, type: ApiErrorDto })
@ApiResponse({ status: 500, type: ApiErrorDto })
@Controller('memory')
export class MemoryController {
  constructor(
    @Inject(PersonalMemory) private readonly memory: PersonalMemory,
  ) {}

  @Get()
  @ApiOkResponse({ type: MemorySnapshotDto })
  async list(@Req() request: AuthenticatedRequest): Promise<MemorySnapshotDto> {
    const snapshot = await this.memory.list(ownerId(request));
    return { ...snapshot, entries: snapshot.entries.map(describeMemoryEntry) };
  }

  @Post()
  @HttpCode(200)
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({ type: SaveMemoryDto })
  @ApiOkResponse({
    type: MemoryEntryDto,
    description:
      'Committed memory or the same saved memory on exact replay. Creates no conversation turn or model work.',
  })
  async save(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<MemoryEntryDto> {
    if (
      request.headers['content-type']?.split(';')[0]?.trim() !==
      'application/json'
    )
      throw new UnsupportedMediaTypeException();
    return describeMemoryEntry(await this.memory.save(ownerId(request), body));
  }

  @Patch(':entryId')
  @HttpCode(200)
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiBody({ type: EditMemoryDto })
  @ApiOkResponse({ type: MemoryEntryDto })
  async edit(
    @Req() request: AuthenticatedRequest,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
  ): Promise<MemoryEntryDto> {
    this.requireJson(request);
    return describeMemoryEntry(
      await this.memory.edit(ownerId(request), entryId, body),
    );
  }

  @Delete(':entryId')
  @HttpCode(200)
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiBody({ type: ForgetMemoryDto })
  @ApiOkResponse({ type: ForgottenMemoryDto })
  async forget(
    @Req() request: AuthenticatedRequest,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
  ): Promise<ForgottenMemoryDto> {
    this.requireJson(request);
    return describeForgottenMemory(
      await this.memory.forget(ownerId(request), entryId, body),
    );
  }

  private requireJson(request: AuthenticatedRequest) {
    if (
      request.headers['content-type']?.split(';')[0]?.trim() !==
      'application/json'
    )
      throw new UnsupportedMediaTypeException();
  }

  @Get('requests/:requestId')
  @ApiParam({ name: 'requestId', format: 'uuid' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(MemoryEntryDto) },
        { $ref: getSchemaPath(ForgottenMemoryDto) },
      ],
    },
    description:
      'Find the saved memory by its original request ID. NOT_FOUND does not prove a pending save cannot still commit; no automatic mutation replay.',
  })
  async findByRequest(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
  ): Promise<MemoryEntryDto | ForgottenMemoryDto> {
    return describeMemoryRecord(
      await this.memory.findByRequest(ownerId(request), requestId),
    );
  }

  @Get(':entryId')
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(MemoryEntryDto) },
        { $ref: getSchemaPath(ForgottenMemoryDto) },
      ],
    },
  })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('entryId') entryId: string,
  ): Promise<MemoryEntryDto | ForgottenMemoryDto> {
    return describeMemoryRecord(
      await this.memory.get(ownerId(request), entryId),
    );
  }
}
