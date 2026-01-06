import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ErrorCode } from '../../errors/error-codes';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const traceId: string | undefined =
      req.requestId || (req.headers['x-request-id'] as string | undefined);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let code: string | undefined;
    let type = 'about:blank';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as unknown;
      // resp can be string or object
      if (typeof resp === 'string') {
        title = resp;
      } else if (resp && typeof resp === 'object') {
        const r = resp as {
          title?: string;
          message?: string;
          detail?: string;
          code?: string;
          type?: string;
        };
        title = r.title ?? this.statusTitle(status);
        detail = r.message ?? r.detail;
        code = r.code ?? code;
        type = r.type ?? type;
      } else {
        title = this.statusTitle(status);
      }
    } else if (exception instanceof Error) {
      // Non-HTTP error
      detail = exception.message;
    }

    if (!code) {
      code = this.defaultCode(status);
    }

    if (status >= 500) {
      // Prefer request logger (nestjs-pino / fastify) so the real stack shows up next to the request log.
      // Fallback to console.error if request logger isn't available.
      const reqLogger = (
        req as FastifyRequest & { log?: { error?: (obj: unknown, msg?: string) => void } }
      ).log;
      if (reqLogger?.error) {
        reqLogger.error(
          {
            err: exception,
            traceId,
            method: req.method,
            url: req.url,
          },
          'Unhandled exception',
        );
      } else {
        console.error('ProblemDetailsFilter exception', {
          traceId,
          method: req.method,
          url: req.url,
          err: exception,
        });
      }
    }

    const problem: Record<string, unknown> = {
      type,
      title,
      status,
      ...(detail ? { detail } : {}),
      ...(code ? { code } : {}),
      ...(traceId ? { traceId } : {}),
    };

    // Ensure headers
    reply.header('X-Request-Id', traceId ?? '');
    reply.header('Content-Type', 'application/problem+json');

    reply.status(status).send(problem);
  }

  private defaultCode(status: number): ErrorCode {
    if (status >= 500) return ErrorCode.INTERNAL;

    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.VALIDATION_FAILED;
    }
  }

  private statusTitle(status: number): string {
    const map: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
      [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
      [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
    };
    return map[status] ?? 'Error';
  }
}
