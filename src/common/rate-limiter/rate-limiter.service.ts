import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { ProblemException } from '../errors/problem.exception';
import { ErrorCode } from '../errors/error-codes';

export interface RateLimitOptions {
  key: string;
  limit: number;
  ttlMs: number;
}

@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  async consume(options: RateLimitOptions) {
    const { key, limit, ttlMs } = options;
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.pexpire(key, ttlMs);
    }
    if (count > limit) {
      throw new ProblemException(429, {
        title: 'Too Many Requests',
        detail: 'Rate limit exceeded. Please try again later.',
        code: ErrorCode.RATE_LIMITED,
      });
    }
  }
}
