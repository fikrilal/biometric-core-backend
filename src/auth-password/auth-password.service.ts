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
import { EmailService } from './email.service';
import { RateLimiterService } from '../common/rate-limiter/rate-limiter.service';
import { AuthTokensResponse } from './dto/auth.response';

@Injectable()
export class AuthPasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly pendingTokens: PendingTokenService,
    private readonly email: EmailService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async register(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ProblemException.conflict('Email already exists');
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
        verificationRequestedAt: new Date(),
      },
    });
    const tokens = await this.issueTokens(user);
    const verificationToken = await this.pendingTokens.createEmailToken(
      user.id,
      24 * 60 * 60 * 1000,
    );
    await this.email.sendVerification(email, verificationToken);
    return tokens;
  }

  async login(dto: LoginDto, ip?: string) {
    const email = this.normalizeEmail(dto.email);
    await this.rateLimiter.consume({
      key: this.buildKey('login', email, ip),
      limit: 5,
      ttlMs: 60 * 1000,
    });
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new ProblemException(401, { title: 'Invalid credentials', code: ErrorCode.UNAUTHORIZED });
    }
    if (!user.emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Please verify your email before logging in.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }
    return this.issueTokens(user);
  }

  async refresh(dto: RefreshDto, ip?: string) {
    await this.rateLimiter.consume({
      key: this.buildKey('refresh', dto.refreshToken, ip),
      limit: 20,
      ttlMs: 60 * 1000,
    });
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ProblemException(401, { title: 'Invalid refresh token', code: ErrorCode.UNAUTHORIZED });
    }
    if (!user.emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Please verify your email before refreshing tokens.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }
    return this.issueTokens(user);
  }

  async logout(dto: RefreshDto) {
    const payload = await this.tokens.verifyRefreshToken(dto.refreshToken).catch(() => null);
    if (!payload) return { success: true };
    const tokenId = payload.jti as string;
    await this.prisma.refreshToken.updateMany({ where: { id: tokenId }, data: { revoked: true } });
    return { success: true };
  }

  async requestVerification(rawEmail: string) {
    const email = this.normalizeEmail(rawEmail);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { success: true };
    const token = await this.pendingTokens.createEmailToken(user.id, 24 * 60 * 60 * 1000);
    await this.prisma.user.update({ where: { id: user.id }, data: { verificationRequestedAt: new Date() } });
    await this.email.sendVerification(email, token);
    return { success: true };
  }

  async confirmVerification(token: string) {
    const userId = await this.pendingTokens.consumeEmailToken(token);
    if (!userId) {
      throw new ProblemException(400, { title: 'Invalid or expired token', code: ErrorCode.VALIDATION_FAILED });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, verificationRequestedAt: null },
    });
    return { success: true };
  }

  async requestPasswordReset(rawEmail: string) {
    const email = this.normalizeEmail(rawEmail);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { success: true };
    const token = await this.pendingTokens.createResetToken(user.id, 30 * 60 * 1000);
    await this.email.sendPasswordReset(email, token);
    return { success: true };
  }

  async confirmPasswordReset(token: string, newPassword: string) {
    const userId = await this.pendingTokens.consumeResetToken(token);
    if (!userId) {
      throw new ProblemException(400, { title: 'Invalid or expired token', code: ErrorCode.VALIDATION_FAILED });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ProblemException.notFound('User not found');
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });
    return { success: true };
  }

  private async issueTokens(user: { id: string; emailVerified: boolean }): Promise<AuthTokensResponse> {
    const access = await this.tokens.signAccessToken(user.id);
    const refreshId = randomUUID();
    const refresh = await this.tokens.signRefreshToken(user.id, refreshId);
    const tokenHash = await argon2.hash(refresh.token, { type: argon2.argon2id });
    await this.prisma.refreshToken.create({
      data: {
        id: refreshId,
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + refresh.expiresIn * 1000),
      },
    });
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
      emailVerified: user.emailVerified,
    };
  }

  private buildKey(type: string, identifier: string, ip?: string) {
    const normalizedId = identifier ?? 'unknown';
    const normalizedIp = ip ?? 'unknown';
    return `rl:${type}:${normalizedId}:${normalizedIp}`;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }
}
