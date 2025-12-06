import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { BiometricChallengeDto } from './dto/biometric-challenge.dto';
import { BiometricChallengeResponse } from './dto/biometric-challenge.response';
import { BiometricVerifyDto } from './dto/biometric-verify.dto';
import type { FastifyRequest } from 'fastify';
import { AuthTokensResponse } from '../auth-password/dto/auth.response';

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
}
