import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { WebAuthnModule } from '../webauthn/webauthn.module';
import { RateLimiterService } from '../common/rate-limiter/rate-limiter.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [PrismaModule, RedisModule, WebAuthnModule, AuthPasswordModule],
  controllers: [AuthController, SessionsController],
  providers: [AuthService, JwtAuthGuard, RateLimiterService, SessionsService],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
