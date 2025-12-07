import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
  }

  async onModuleInit() {
    if (this.client.status === 'wait') {
      await this.client.connect();
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
