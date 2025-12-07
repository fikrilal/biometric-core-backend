import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor<unknown, unknown> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const headerName = 'x-request-id';
    const incoming = req?.headers?.[headerName] as string | undefined;
    const requestId = incoming && typeof incoming === 'string' && incoming.trim() !== ''
      ? incoming
      : randomUUID();

    // Attach to request for downstream use (e.g., error filter)
    (req as FastifyRequest & { requestId?: string }).requestId = requestId;

    // Echo on response when completed
    return next.handle().pipe(
      tap({
        next: () => reply.header('X-Request-Id', requestId),
        error: () => reply.header('X-Request-Id', requestId),
      }),
    );
  }
}
