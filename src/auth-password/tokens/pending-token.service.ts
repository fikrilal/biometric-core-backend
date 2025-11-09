import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';

@Injectable()
export class PendingTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async createEmailToken(userId: string, ttlMs: number) {
    const token = this.generateToken();
    const hash = await argon2.hash(token, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: hash, expiresAt },
    });
    return token;
  }

  async consumeEmailToken(userId: string, token: string) {
    const record = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return false;
    const valid = await argon2.verify(record.tokenHash, token).catch(() => false);
    if (!valid || record.expiresAt < new Date()) return false;
    await this.prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  async createResetToken(userId: string, ttlMs: number) {
    const token = this.generateToken();
    const hash = await argon2.hash(token, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.passwordResetToken.create({ data: { userId, tokenHash: hash, expiresAt } });
    return token;
  }

  async consumeResetToken(userId: string, token: string) {
    const record = await this.prisma.passwordResetToken.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return false;
    const valid = await argon2.verify(record.tokenHash, token).catch(() => false);
    if (!valid || record.expiresAt < new Date()) return false;
    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  private generateToken() {
    return randomBytes(32).toString('hex');
  }
}
