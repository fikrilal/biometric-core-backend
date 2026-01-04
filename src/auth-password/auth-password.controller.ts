import { Body, Controller, HttpCode, Post, Res, Req } from '@nestjs/common';
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
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with email/password' })
  login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    return this.service.login(dto, req.ip);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token' })
  refresh(@Body() dto: RefreshDto, @Req() req: FastifyRequest) {
    return this.service.refresh(dto, req.ip);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke refresh token' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.service.logout(dto);
  }

  @Post('verify/request')
  @HttpCode(204)
  @ApiOperation({ summary: 'Send verification email' })
  async verifyRequest(@Body() dto: VerifyRequestDto): Promise<void> {
    await this.service.requestVerification(dto.email);
  }

  @Post('verify/confirm')
  @HttpCode(204)
  @ApiOperation({ summary: 'Confirm verification token' })
  async verifyConfirm(@Body() dto: VerifyConfirmDto): Promise<void> {
    await this.service.confirmVerification(dto.token);
  }

  @Post('reset/request')
  @HttpCode(204)
  @ApiOperation({ summary: 'Send password reset email' })
  async resetRequest(@Body() dto: ResetRequestDto): Promise<void> {
    await this.service.requestPasswordReset(dto.email);
  }

  @Post('reset/confirm')
  @HttpCode(204)
  @ApiOperation({ summary: 'Confirm password reset' })
  async resetConfirm(@Body() dto: ResetConfirmDto): Promise<void> {
    await this.service.confirmPasswordReset(dto.token, dto.newPassword);
  }
}
