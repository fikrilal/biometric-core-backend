import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGoogleService } from './auth-google.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { AuthSessionResponse } from '../auth-password/dto/auth.response';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { FastifyRequest } from 'fastify';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';

@ApiTags('auth')
@Controller('auth/google')
export class AuthGoogleController {
  constructor(private readonly service: AuthGoogleService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Login or register with Google' })
  authenticate(@Body() dto: GoogleAuthDto): Promise<AuthSessionResponse> {
    return this.service.authenticate(dto.idToken);
  }

  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Connect Google account to current user' })
  @ApiNoContentResponse({ description: 'No Content' })
  async connect(
    @CurrentUser() user: FastifyRequest['user'],
    @Body() dto: GoogleAuthDto,
  ): Promise<void> {
    if (!user) {
      throw new ProblemException(401, { title: 'Unauthorized', code: ErrorCode.UNAUTHORIZED });
    }
    await this.service.connect(user.userId, dto.idToken);
  }
}
