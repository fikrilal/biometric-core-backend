import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req: any = http.getRequest();
    const reply: any = http.getResponse();

    const headerName = 'x-request-id';
    const incoming = req?.headers?.[headerName] as string | undefined;
    const requestId = incoming && typeof incoming === 'string' && incoming.trim() !== ''
      ? incoming
      : randomUUID();

    // Attach to request for downstream use (e.g., error filter)
    req.requestId = requestId;

    // Echo on response when completed
    return next.handle().pipe(
      tap({
        next: () => reply?.header?.('X-Request-Id', requestId),
        error: () => reply?.header?.('X-Request-Id', requestId),
      }),
    );
  }
}

