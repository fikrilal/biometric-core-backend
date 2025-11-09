import { Module } from '@nestjs/common';
import { AuthPasswordService } from './auth-password.service';
import { AuthPasswordController } from './auth-password.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { TokenService } from './token.service';
import { PendingTokenService } from './tokens/pending-token.service';
import { MockEmailService, ResendEmailService, emailServiceProvider } from './email.service';
import { RateLimiterService } from '../common/rate-limiter/rate-limiter.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [AuthPasswordController],
  providers: [
    AuthPasswordService,
    TokenService,
    PendingTokenService,
    RateLimiterService,
    ResendEmailService,
    MockEmailService,
    emailServiceProvider,
  ],
})
export class AuthPasswordModule {}
