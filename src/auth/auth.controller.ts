import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { BiometricChallengeDto } from './dto/biometric-challenge.dto';
import { BiometricChallengeResponse } from './dto/biometric-challenge.response';
import { BiometricVerifyDto } from './dto/biometric-verify.dto';
import type { FastifyRequest } from 'fastify';
import { AuthTokensResponse } from '../auth-password/dto/auth.response';
import { StepUpChallengeDto } from './dto/step-up-challenge.dto';
import { StepUpChallengeResponse } from './dto/step-up-challenge.response';
import { StepUpVerifyDto } from './dto/step-up-verify.dto';
import { StepUpVerifyResponse } from './dto/step-up-verify.response';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('ping')
  ping() {
    return this.authService.ping();
  }

  @Post('challenge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create biometric authentication challenge' })
  createChallenge(
    @Body() dto: BiometricChallengeDto,
    @Req() req: FastifyRequest,
  ): Promise<BiometricChallengeResponse> {
    return this.authService.createBiometricLoginChallenge(dto, req.ip);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify biometric authentication and issue tokens' })
  verify(@Body() dto: BiometricVerifyDto): Promise<AuthTokensResponse> {
    return this.authService.verifyBiometricLogin(dto);
  }

  @Post('step-up/challenge')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Create step-up authentication challenge' })
  createStepUpChallenge(
    @CurrentUser() user: FastifyRequest['user'],
    @Body() dto: StepUpChallengeDto,
    @Req() req: FastifyRequest,
  ): Promise<StepUpChallengeResponse> {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.authService.createStepUpChallenge(user.userId, dto, req.ip);
  }

  @Post('step-up/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify step-up authentication and issue token' })
  verifyStepUp(
    @CurrentUser() user: FastifyRequest['user'],
    @Body() dto: StepUpVerifyDto,
  ): Promise<StepUpVerifyResponse> {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.authService.verifyStepUp(user.userId, dto);
  }
}
