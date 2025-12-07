import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuthPasswordModule } from '../auth-password/auth-password.module';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';

@Module({
  imports: [PrismaModule, AuthModule, AuthPasswordModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
