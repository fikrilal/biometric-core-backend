import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { PageQueryDto } from '../common/pagination/page-query.dto';
import { UserResponse } from './dto/user.response';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';

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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user' })
  async getMe(@CurrentUser() user: FastifyRequest['user']): Promise<UserResponse> {
    if (!user) {
      throw new ProblemException(401, { title: 'Unauthorized', code: ErrorCode.UNAUTHORIZED });
    }
    return this.usersService.findOne(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.findOne(id);
  }
}
