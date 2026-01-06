import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private lastClientError: Error | undefined;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('REDIS_URL');
    const tlsRejectUnauthorizedRaw = process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
    const tlsRejectUnauthorized =
      tlsRejectUnauthorizedRaw === undefined
        ? true
        : !['false', '0'].includes(tlsRejectUnauthorizedRaw.trim().toLowerCase());
    const isTls = url.trim().toLowerCase().startsWith('rediss://');

    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      ...(isTls ? { tls: { rejectUnauthorized: tlsRejectUnauthorized } } : {}),
    });

    this.client.on('error', (error) => {
      if (error instanceof Error) {
        this.lastClientError = error;
      }
      this.logger.error({ err: error }, 'Redis client error');
    });
  }

  async onModuleInit() {
    if (this.client.status !== 'wait') return;
    try {
      await this.client.connect();
    } catch (error) {
      const lastErrorMessage = this.lastClientError?.message;
      const suffix = lastErrorMessage ? ` (last error: ${lastErrorMessage})` : '';
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Redis connect failed: ${message}${suffix}`);
    }
  }

  getClient() {
    return this.client;
  }

  async onModuleDestroy() {
    try {
      if (this.client.status === 'end' || this.client.status === 'wait') {
        return;
      }
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
