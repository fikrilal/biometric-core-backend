import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';

@Module({
  imports: [AuthModule, AuthPasswordModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
