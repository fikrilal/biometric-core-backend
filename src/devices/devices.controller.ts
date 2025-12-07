import { Controller, Delete, Get, HttpCode, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { FastifyRequest } from 'fastify';
import { PageQueryDto } from '../common/pagination/page-query.dto';

@ApiTags('devices')
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'List devices for current user' })
  list(
    @CurrentUser() user: FastifyRequest['user'],
    @Query() query: PageQueryDto,
  ) {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.devices.listForUser(user.userId, query.cursor, query.limit);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a device by id' })
  async revoke(@CurrentUser() user: FastifyRequest['user'], @Param('id') id: string) {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    await this.devices.revoke(user.userId, id);
  }
}

