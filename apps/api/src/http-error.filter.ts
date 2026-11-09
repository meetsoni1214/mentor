import type { ServerResponse } from 'node:http';
import { ConversationError } from '@mentor/backend/conversation';
import { MemoryError } from '@mentor/backend/memory';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

const errors: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'The request is invalid.' },
  401: {
    code: 'UNAUTHORIZED',
    message: 'Sign-in failed or your session has expired.',
  },
  403: {
    code: 'FORBIDDEN',
    message: 'The request could not be authorized. Refresh and try again.',
  },
  404: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
  415: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Use an application/json request.',
  },
  429: {
    code: 'RATE_LIMITED',
    message: 'Too many sign-in attempts. Try again later.',
  },
  503: {
    code: 'UNAVAILABLE',
    message: 'The service is temporarily unavailable.',
  },
};

const conversationErrors: Record<
  ConversationError['code'],
  { status: number; message: string }
> = {
  EXECUTION_UNAVAILABLE: {
    status: 503,
    message:
      'Assistant execution is unavailable. History remains readable and clearable.',
  },
  NOT_FOUND: { status: 404, message: 'The conversation turn was not found.' },
  INVALID_INPUT: {
    status: 400,
    message: 'The conversation request is invalid.',
  },
  STALE_HISTORY: {
    status: 409,
    message:
      'History has changed. Reload the conversation before trying again.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'This request identifier was already used with different input.',
  },
  BUSY: {
    status: 409,
    message:
      'The assistant is already working. Wait for the current attempt to finish.',
  },
  NOT_RETRYABLE: {
    status: 409,
    message: 'Only the latest failed or interrupted turn can be retried.',
  },
};

const memoryErrors: Record<
  MemoryError['code'],
  { status: number; message: string }
> = {
  INVALID_INPUT: {
    status: 400,
    message:
      'Use a direct Remember that request with nonblank wording of at most 512 UTF-8 bytes and an original request of at most 1024 bytes.',
  },
  NOT_FOUND: {
    status: 404,
    message: 'The memory was not found.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'This request identifier was already used with different input.',
  },
  BUSY: {
    status: 409,
    message:
      'The assistant is working. Wait for the current attempt to finish before changing memory.',
  },
  LIMIT_EXCEEDED: {
    status: 409,
    message:
      'Memory is full. The profile allows 20 entries and 4096 UTF-8 bytes of wording.',
  },
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const applicationError =
      error instanceof ConversationError
        ? conversationErrors[error.code]
        : error instanceof MemoryError
          ? memoryErrors[error.code]
          : undefined;
    const status =
      applicationError?.status ??
      (error instanceof HttpException
        ? error.getStatus()
        : error instanceof Error &&
            'type' in error &&
            error.type === 'entity.too.large' &&
            'status' in error &&
            error.status === 413
          ? 413
          : 500);
    if (status >= 500)
      Logger.error('An API request failed; check service health.', 'HTTP');
    response.statusCode = status;
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        statusCode: status,
        ...(applicationError &&
        (error instanceof ConversationError || error instanceof MemoryError)
          ? { code: error.code, message: applicationError.message }
          : (errors[status] ?? {
              code: 'INTERNAL_ERROR',
              message: 'The request could not be completed.',
            })),
      }),
    );
  }
}
