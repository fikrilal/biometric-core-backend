import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { ResponseEnvelopeInterceptor } from './common/http/interceptors/response-envelope.interceptor';
import { RequestIdInterceptor } from './common/http/interceptors/request-id.interceptor';
import { ProblemDetailsFilter } from './common/http/filters/problem-details.filter';
import { IdempotencyInterceptor } from './common/http/interceptors/idempotency.interceptor';
import { AuthPasswordModule } from './auth-password/auth-password.module';
import { UsersModule } from './users/users.module';
import { WebAuthnModule } from './webauthn/webauthn.module';
import { EnrollmentModule } from './enrollment/enrollment.module';
import { DevicesModule } from './devices/devices.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
      },
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    WebAuthnModule,
    AuthModule,
    UsersModule,
    AuthPasswordModule,
    EnrollmentModule,
    DevicesModule,
    WalletsModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
