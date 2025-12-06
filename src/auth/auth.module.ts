import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [AuthPasswordModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
