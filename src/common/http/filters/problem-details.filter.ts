import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req: any = ctx.getRequest();
    const reply: any = ctx.getResponse();

    const traceId: string | undefined = req?.requestId || req?.headers?.['x-request-id'];

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let code: string | undefined;
    let type = 'about:blank';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as any;
      // resp can be string or object
      if (typeof resp === 'string') {
        title = resp;
      } else if (resp && typeof resp === 'object') {
        title = resp.title ?? this.statusTitle(status);
        detail = resp.message ?? resp.detail;
        code = resp.code ?? code;
        type = resp.type ?? type;
      } else {
        title = this.statusTitle(status);
      }
    } else if (exception instanceof Error) {
      // Non-HTTP error
      detail = exception.message;
    }

    const problem: Record<string, any> = {
      type,
      title,
      status,
      ...(detail ? { detail } : {}),
      ...(code ? { code } : {}),
      ...(traceId ? { traceId } : {}),
    };

    // Ensure headers
    reply?.header?.('X-Request-Id', traceId ?? '');
    reply?.header?.('Content-Type', 'application/problem+json');

    reply?.status?.(status).send?.(problem);
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

