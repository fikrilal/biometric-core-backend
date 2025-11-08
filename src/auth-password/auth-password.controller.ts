import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPasswordService } from './auth-password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import type { FastifyReply } from 'fastify';

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
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token' })
  refresh(@Body() dto: RefreshDto) {
    return this.service.refresh(dto);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke refresh token' })
  logout(@Body() dto: RefreshDto) {
    return this.service.logout(dto);
  }
}
