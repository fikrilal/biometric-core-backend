import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    // Optional eager connect; uncomment if preferred.
    // await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
