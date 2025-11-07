import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const reply: any = http.getResponse();
    const handler = context.getHandler();
    const cls = context.getClass();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      handler,
      cls,
    ]);

    return next.handle().pipe(
      map((data) => {
        if (skip) return data;

        // If Fastify/Nest has set 204 No Content, don't envelope
        const statusCode = reply?.statusCode;
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
          'items' in data &&
          Array.isArray((data as any).items)
        ) {
          const { items, nextCursor, limit, ...rest } = data as any;
          const meta: Record<string, any> = {};
          if (nextCursor !== undefined) meta.nextCursor = nextCursor;
          if (limit !== undefined) meta.limit = limit;
          const envelope: any = { data: items };
          if (Object.keys(meta).length) envelope.meta = meta;
          // Preserve any additional top-level fields not standard
          if (Object.keys(rest).length) envelope.extra = rest;
          return envelope;
        }

        // Already enveloped
        if (
          typeof data === 'object' &&
          data !== null &&
          ('data' in (data as any) || 'meta' in (data as any))
        ) {
          return data;
        }

        return { data };
      }),
    );
  }
}

