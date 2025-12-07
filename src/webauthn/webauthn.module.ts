import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebAuthnService } from './webauthn.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [WebAuthnService],
  exports: [WebAuthnService],
})
export class WebAuthnModule {}

