import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { createHash, randomUUID } from 'crypto';
import { RedisService } from '../../../redis/redis.service';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ProblemException } from '../../errors/problem.exception';
import { ErrorCode } from '../../errors/error-codes';

interface CachedResponse {
  statusCode: number;
  body: unknown;
  headers?: {
    location?: string;
  };
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor<unknown, unknown> {
  private readonly ttlSeconds = 24 * 60 * 60; // 24h

  constructor(private readonly redis: RedisService) {}

  async tryGetCached(cacheKey: string): Promise<CachedResponse | null> {
    const client = this.redis.getClient();
    const raw = await client.get(cacheKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedResponse;
    } catch {
      return null;
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const method = (req?.method || '').toUpperCase();
    if (method !== 'POST' && method !== 'DELETE') {
      return next.handle();
    }

    const keyHeader = req.headers['idempotency-key'] as string | undefined;
    if (!keyHeader || typeof keyHeader !== 'string' || keyHeader.trim() === '') {
      return next.handle();
    }

    const hash = createHash('sha256').update(keyHeader).digest('hex');
    const url = typeof req.url === 'string' ? req.url : '';
    const cacheKey = `idemp:${method}:${url}:${hash}`;
    const lockKey = `${cacheKey}:lock`;

    const client = this.redis.getClient();

    // If cached, replay immediately
    const replayPromise = this.tryGetCached(cacheKey).then((cached) => {
      if (!cached) return null;
      reply.header('Idempotency-Replayed', 'true');
      if (cached.headers?.location) {
        reply.header('Location', cached.headers.location);
      }
      reply.status(cached.statusCode);
      return cached.body;
    });

    return new Observable((subscriber) => {
      (async () => {
        const cached = await replayPromise;
        if (cached !== null) {
          subscriber.next(cached);
          subscriber.complete();
          return;
        }

        // Acquire a short lock to prevent duplicate work
        const acquired = await client.setnx(lockKey, randomUUID());
        if (acquired) {
          await client.pexpire(lockKey, 30000);
        }
        if (!acquired) {
          // Someone else is processing. Wait briefly for a cached result.
          const deadline = Date.now() + 2000; // 2s
          let body: unknown = null;
          while (Date.now() < deadline) {
            const nowCached = await this.tryGetCached(cacheKey);
            if (nowCached) {
              reply.header('Idempotency-Replayed', 'true');
              if (nowCached.headers?.location) {
                reply.header('Location', nowCached.headers.location);
              }
              reply.status(nowCached.statusCode);
              body = nowCached.body;
              break;
            }
            await new Promise((r) => setTimeout(r, 100));
          }
          if (body !== null) {
            subscriber.next(body);
            subscriber.complete();
            return;
          }
          // Still not ready; treat as in-progress to keep semantics strict.
          subscriber.error(
            ProblemException.conflict(
              'A request with the same Idempotency-Key is in progress',
              ErrorCode.IDEMPOTENCY_IN_PROGRESS,
            ),
          );
          return;
        }

        // Proceed and cache result
        next
          .handle()
          .pipe(
            map((data) => {
              const statusCode = reply.statusCode ?? 200;
              const getHeader = (reply as unknown as { getHeader?: (key: string) => unknown }).getHeader;
              const location =
                typeof getHeader === 'function'
                  ? (getHeader('Location') as string | undefined)
                  : undefined;
              const payload: CachedResponse = {
                statusCode,
                body: data,
                headers: location ? { location } : undefined,
              };
              // fire-and-forget cache store
              client
                .multi()
                .set(cacheKey, JSON.stringify(payload), 'EX', this.ttlSeconds)
                .del(lockKey)
                .exec()
                .catch(() => void 0);
              return data;
            }),
          )
          .subscribe({
            next: (val) => subscriber.next(val),
            error: (err) => {
              client.del(lockKey).catch(() => void 0);
              subscriber.error(err);
            },
            complete: () => subscriber.complete(),
          });
      })().catch((e) => subscriber.error(e));
    });
  }
}
