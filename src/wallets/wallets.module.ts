import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';

@Module({
  imports: [PrismaModule, AuthModule, AuthPasswordModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
