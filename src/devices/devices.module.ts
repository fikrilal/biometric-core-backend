import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}

