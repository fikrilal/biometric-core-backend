import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { PageQueryDto } from '../common/pagination/page-query.dto';
import { UserResponse } from './dto/user.response';
import type { FastifyReply } from 'fastify';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create user' })
  async create(@Body() dto: CreateUserDto, @Res({ passthrough: true }) reply: FastifyReply): Promise<UserResponse> {
    const user = await this.usersService.create(dto);
    reply.header('Location', `/v1/users/${user.id}`);
    return user;
  }

  @Get()
  @ApiOperation({ summary: 'List users' })
  async findAll(@Query() query: PageQueryDto) {
    return this.usersService.findAll(query.cursor, query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.findOne(id);
  }
}
