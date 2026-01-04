import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { AuthModule } from '../auth/auth.module';
import { AuthGoogleController } from './auth-google.controller';
import { AuthGoogleService } from './auth-google.service';
import { GoogleOidcService } from './google-oidc.service';

@Module({
  imports: [PrismaModule, AuthPasswordModule, AuthModule],
  controllers: [AuthGoogleController],
  providers: [AuthGoogleService, GoogleOidcService],
})
export class AuthGoogleModule {}

