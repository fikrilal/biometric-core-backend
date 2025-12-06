import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { EnrollmentService } from './enrollment.service';
import { EnrollChallengeDto } from './dto/enroll-challenge.dto';
import { EnrollChallengeResponse } from './dto/enroll-challenge.response';
import { EnrollVerifyDto } from './dto/enroll-verify.dto';
import { EnrollVerifyResponse } from './dto/enroll-verify.response';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('enrollment')
@Controller('enroll')
export class EnrollmentController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Post('challenge')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create WebAuthn enrollment challenge' })
  async createChallenge(
    @CurrentUser() user: FastifyRequest['user'],
    @Body() dto: EnrollChallengeDto,
    @Req() req: FastifyRequest,
  ): Promise<EnrollChallengeResponse> {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.enrollment.createChallenge(user.userId, dto, req.ip);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify WebAuthn enrollment response' })
  async verify(@Body() dto: EnrollVerifyDto): Promise<EnrollVerifyResponse> {
    return this.enrollment.verifyEnrollment(dto);
  }
}

