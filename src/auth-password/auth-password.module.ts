import { Module } from '@nestjs/common';
import { AuthPasswordService } from './auth-password.service';
import { AuthPasswordController } from './auth-password.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { TokenService } from './token.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [AuthPasswordController],
  providers: [AuthPasswordService, TokenService],
})
export class AuthPasswordModule {}
