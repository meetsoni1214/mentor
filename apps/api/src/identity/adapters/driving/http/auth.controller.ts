import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  InvalidCredentialsError,
  LoginThrottledError,
  loginCredentials,
} from '@mentor/backend/identity';
import { PublicRoute } from '@mentor/backend/http';
import type { ActiveSession } from '@mentor/backend/identity';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthHttpService } from './auth-http.service.js';
import type { AuthenticatedRequest } from './auth-http.service.js';
import { ApiErrorDto, CsrfDto, LoginDto, SessionDto } from './auth.dto.js';

function describeSession(session: ActiveSession): SessionDto {
  return {
    owner: session.owner,
    expiresAt: session.expiresAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
  };
}

@ApiTags('authentication')
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 500, type: ApiErrorDto })
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthHttpService) private readonly auth: AuthHttpService,
  ) {}

  @PublicRoute()
  @Get('csrf')
  @ApiOkResponse({ type: CsrfDto })
  csrf(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): CsrfDto {
    return { token: this.auth.issueCsrf(request, response) };
  }

  @PublicRoute()
  @Post('login')
  @HttpCode(200)
  @ApiBody({ type: LoginDto })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: SessionDto })
  @ApiResponse({ status: 401, type: ApiErrorDto })
  @ApiResponse({ status: 429, type: ApiErrorDto })
  @ApiResponse({ status: 415, type: ApiErrorDto })
  async login(
    @Body() body: unknown,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionDto> {
    if (
      request.headers['content-type']?.split(';')[0]?.trim() !==
      'application/json'
    )
      throw new UnsupportedMediaTypeException();
    const credentials = loginCredentials.safeParse(body);
    if (!credentials.success) throw new UnauthorizedException();
    try {
      const { token, session } = await this.auth.sessions.login(
        credentials.data,
        this.auth.sessionToken(request),
      );
      this.auth.setSession(response, token);
      return describeSession(session);
    } catch (error) {
      if (error instanceof InvalidCredentialsError)
        throw new UnauthorizedException();
      if (error instanceof LoginThrottledError) {
        response.setHeader('Retry-After', error.retryAfterSeconds);
        throw new HttpException('Too many sign-in attempts.', 429);
      }
      throw error;
    }
  }

  @Get('session')
  @ApiCookieAuth()
  @ApiOkResponse({ type: SessionDto })
  @ApiResponse({ status: 401, type: ApiErrorDto })
  session(@Req() request: AuthenticatedRequest): SessionDto {
    if (!request.authSession) throw new UnauthorizedException();
    return describeSession(request.authSession);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ApiErrorDto })
  async logout(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const token = this.auth.sessionToken(request);
    if (!token) throw new UnauthorizedException();
    await this.auth.sessions.logout(token);
    this.auth.clearSession(response);
  }
}
