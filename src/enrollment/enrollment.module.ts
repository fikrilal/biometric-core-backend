import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { WebAuthnModule } from '../webauthn/webauthn.module';
import { EnrollmentService } from './enrollment.service';
import { EnrollmentController } from './enrollment.controller';
import { RateLimiterService } from '../common/rate-limiter/rate-limiter.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, RedisModule, WebAuthnModule, AuthModule],
  controllers: [EnrollmentController],
  providers: [EnrollmentService, RateLimiterService],
})
export class EnrollmentModule {}

