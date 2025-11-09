import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TokenService } from './token.service';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PendingTokenService } from './tokens/pending-token.service';
import { MockEmailService } from './email.service';

@Injectable()
export class AuthPasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly pendingTokens: PendingTokenService,
    private readonly email: MockEmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw ProblemException.conflict('Email already exists');
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
      },
    });
    const tokens = await this.issueTokens(user.id);
    const verificationToken = await this.pendingTokens.createEmailToken(
      user.id,
      24 * 60 * 60 * 1000,
    );
    await this.email.sendVerification(dto.email, verificationToken);
    return tokens;
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new ProblemException(401, { title: 'Invalid credentials', code: ErrorCode.UNAUTHORIZED });
    }
    return this.issueTokens(user.id);
  }

  async refresh(dto: RefreshDto) {
    const payload = await this.tokens.verifyRefreshToken(dto.refreshToken).catch(() => {
      throw new ProblemException(401, { title: 'Invalid refresh token', code: ErrorCode.UNAUTHORIZED });
    });
    const tokenId = payload.jti as string;
    const userId = payload.sub as string;
    const record = await this.prisma.refreshToken.findUnique({ where: { id: tokenId } });
    if (!record || record.revoked || record.userId !== userId) {
      throw new ProblemException(401, { title: 'Invalid refresh token', code: ErrorCode.UNAUTHORIZED });
    }
    const valid = await argon2.verify(record.tokenHash, dto.refreshToken).catch(() => false);
    if (!valid) {
      throw new ProblemException(401, { title: 'Invalid refresh token', code: ErrorCode.UNAUTHORIZED });
    }
    await this.prisma.refreshToken.update({ where: { id: tokenId }, data: { revoked: true } });
    return this.issueTokens(userId);
  }

  async logout(dto: RefreshDto) {
    const payload = await this.tokens.verifyRefreshToken(dto.refreshToken).catch(() => null);
    if (!payload) return { success: true };
    const tokenId = payload.jti as string;
    await this.prisma.refreshToken.updateMany({ where: { id: tokenId }, data: { revoked: true } });
    return { success: true };
  }

  async requestVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { success: true };
    const token = await this.pendingTokens.createEmailToken(user.id, 24 * 60 * 60 * 1000);
    await this.prisma.user.update({ where: { id: user.id }, data: { verificationRequestedAt: new Date() } });
    await this.email.sendVerification(email, token);
    return { success: true };
  }

  async confirmVerification(email: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw ProblemException.notFound('User not found');
    const ok = await this.pendingTokens.consumeEmailToken(user.id, token);
    if (!ok) {
      throw new ProblemException(400, { title: 'Invalid or expired token', code: ErrorCode.VALIDATION_FAILED });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { success: true };
    const token = await this.pendingTokens.createResetToken(user.id, 30 * 60 * 1000);
    await this.email.sendPasswordReset(email, token);
    return { success: true };
  }

  async confirmPasswordReset(email: string, token: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw ProblemException.notFound('User not found');
    const ok = await this.pendingTokens.consumeResetToken(user.id, token);
    if (!ok) {
      throw new ProblemException(400, { title: 'Invalid or expired token', code: ErrorCode.VALIDATION_FAILED });
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });
    return { success: true };
  }

  private async issueTokens(userId: string) {
    const access = await this.tokens.signAccessToken(userId);
    const refreshId = randomUUID();
    const refresh = await this.tokens.signRefreshToken(userId, refreshId);
    const tokenHash = await argon2.hash(refresh.token, { type: argon2.argon2id });
    await this.prisma.refreshToken.create({
      data: {
        id: refreshId,
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + refresh.expiresIn * 1000),
      },
    });
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
    };
  }
}
