import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthModule } from '../auth/auth.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { TransactionsMetricsService } from './transactions.metrics';

@Module({
  imports: [PrismaModule, WalletsModule, AuthModule, AuthPasswordModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsMetricsService],
})
export class TransactionsModule {}
