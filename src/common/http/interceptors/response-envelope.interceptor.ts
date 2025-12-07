import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import type { FastifyReply } from 'fastify';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const handler = context.getHandler();
    const cls = context.getClass();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      handler,
      cls,
    ]);

    return next.handle().pipe(
      map((data: unknown) => {
        if (skip) return data;

        // If Fastify/Nest has set 204 No Content, don't envelope
        const statusCode = reply.statusCode;
        if (statusCode === 204) return data;

        // Pass through for streams/buffers/strings
        if (
          data === undefined ||
          data === null ||
          typeof data === 'string' ||
          Buffer.isBuffer(data)
        ) {
          return data;
        }

        // Auto-convert list shape { items, nextCursor, limit } to envelope
        if (
          typeof data === 'object' &&
          data !== null &&
          'items' in (data as Record<string, unknown>) &&
          Array.isArray((data as { items: unknown[] }).items)
        ) {
          const { items, nextCursor, limit, ...rest } = data as {
            items: unknown[];
            nextCursor?: string;
            limit?: number;
            [k: string]: unknown;
          };
          const meta: Record<string, unknown> = {};
          if (nextCursor !== undefined) meta.nextCursor = nextCursor;
          if (limit !== undefined) meta.limit = limit;
          const envelope: { data: unknown[]; meta?: Record<string, unknown>; extra?: Record<string, unknown> } = {
            data: items,
          };
          if (Object.keys(meta).length) envelope.meta = meta;
          // Preserve any additional top-level fields not standard
          if (Object.keys(rest).length) envelope.extra = rest;
          return envelope;
        }

        // Already enveloped
        if (
          typeof data === 'object' &&
          data !== null &&
          ('data' in (data as Record<string, unknown>) || 'meta' in (data as Record<string, unknown>))
        ) {
          return data;
        }

        return { data } as { data: unknown };
      }),
    );
  }
}
