import { PUBLIC_ROUTE } from '@mentor/backend';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthHttpService } from './auth-http.service.js';
import type { AuthenticatedRequest } from './auth-http.service.js';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthHttpService) private readonly auth: AuthHttpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '') &&
      !this.auth.validMutation(request)
    ) {
      throw new ForbiddenException();
    }
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const session = await this.auth.sessions.authenticate(
      this.auth.sessionToken(request),
    );
    if (!session) throw new UnauthorizedException();
    request.authSession = session;
    return true;
  }
}
