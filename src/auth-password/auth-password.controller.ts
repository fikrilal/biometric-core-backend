import { Body, Controller, Post, Res, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPasswordService } from './auth-password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyRequestDto } from './dto/verify-request.dto';
import { VerifyConfirmDto } from './dto/verify-confirm.dto';
import { ResetRequestDto } from './dto/reset-request.dto';
import { ResetConfirmDto } from './dto/reset-confirm.dto';
import type { FastifyReply, FastifyRequest } from 'fastify';

@ApiTags('auth-password')
@Controller('auth/password')
export class AuthPasswordController {
  constructor(private readonly service: AuthPasswordService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register with email/password' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.service.register(dto);
    reply.header('Location', '/v1/auth/password/register');
    return result;
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email/password' })
  login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    return this.service.login(dto, req.ip);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token' })
  refresh(@Body() dto: RefreshDto, @Req() req: FastifyRequest) {
    return this.service.refresh(dto, req.ip);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke refresh token' })
  logout(@Body() dto: RefreshDto) {
    return this.service.logout(dto);
  }

  @Post('verify/request')
  @ApiOperation({ summary: 'Send verification email' })
  verifyRequest(@Body() dto: VerifyRequestDto) {
    return this.service.requestVerification(dto.email);
  }

  @Post('verify/confirm')
  @ApiOperation({ summary: 'Confirm verification token' })
  verifyConfirm(@Body() dto: VerifyConfirmDto) {
    return this.service.confirmVerification(dto.token);
  }

  @Post('password/reset/request')
  @ApiOperation({ summary: 'Send password reset email' })
  resetRequest(@Body() dto: ResetRequestDto) {
    return this.service.requestPasswordReset(dto.email);
  }

  @Post('password/reset/confirm')
  @ApiOperation({ summary: 'Confirm password reset' })
  resetConfirm(@Body() dto: ResetConfirmDto) {
    return this.service.confirmPasswordReset(dto.token, dto.newPassword);
  }
}
