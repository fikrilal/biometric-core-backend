import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { SessionsService } from './sessions.service';

@ApiTags('auth')
@Controller('auth/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post('revoke')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke all refresh tokens for current user' })
  @ApiNoContentResponse({ description: 'No Content' })
  async revokeAll(@CurrentUser() user: FastifyRequest['user']): Promise<void> {
    if (!user) {
      throw new ProblemException(401, { title: 'Unauthorized', code: ErrorCode.UNAUTHORIZED });
    }
    await this.sessions.revokeAllForUser(user.userId);
  }
}
