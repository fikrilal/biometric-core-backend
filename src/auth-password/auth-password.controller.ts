import { Body, Controller, HttpCode, Post, Res, Req, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPasswordService } from './auth-password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyRequestDto } from './dto/verify-request.dto';
import { VerifyConfirmDto } from './dto/verify-confirm.dto';
import { ResetRequestDto } from './dto/reset-request.dto';
import { ResetConfirmDto } from './dto/reset-confirm.dto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthSessionResponse } from './dto/auth.response';

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
  @ApiNoContentResponse({ description: 'No Content' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.service.logout(dto);
  }

  @Post('change')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Change password for current user' })
  changePassword(
    @CurrentUser() user: FastifyRequest['user'],
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthSessionResponse> {
    if (!user) {
      throw new ProblemException(401, { title: 'Unauthorized', code: ErrorCode.UNAUTHORIZED });
    }
    return this.service.changePassword(user.userId, dto);
  }

  @Post('verify/request')
  @HttpCode(204)
  @ApiOperation({ summary: 'Send verification email' })
  @ApiNoContentResponse({ description: 'No Content' })
  async verifyRequest(@Body() dto: VerifyRequestDto): Promise<void> {
    await this.service.requestVerification(dto.email);
  }

  @Post('verify/confirm')
  @HttpCode(204)
  @ApiOperation({ summary: 'Confirm verification token' })
  @ApiNoContentResponse({ description: 'No Content' })
  async verifyConfirm(@Body() dto: VerifyConfirmDto): Promise<void> {
    await this.service.confirmVerification(dto.token);
  }

  @Post('reset/request')
  @HttpCode(204)
  @ApiOperation({ summary: 'Send password reset email' })
  @ApiNoContentResponse({ description: 'No Content' })
  async resetRequest(@Body() dto: ResetRequestDto): Promise<void> {
    await this.service.requestPasswordReset(dto.email);
  }

  @Post('reset/confirm')
  @HttpCode(204)
  @ApiOperation({ summary: 'Confirm password reset' })
  @ApiNoContentResponse({ description: 'No Content' })
  async resetConfirm(@Body() dto: ResetConfirmDto): Promise<void> {
    await this.service.confirmPasswordReset(dto.token, dto.newPassword);
  }
}
