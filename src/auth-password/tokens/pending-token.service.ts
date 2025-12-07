import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';

@Injectable()
export class PendingTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async createEmailToken(userId: string, ttlMs: number) {
    const secret = this.generateSecret();
    const hash = await argon2.hash(secret, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ttlMs);
    const record = await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: hash, expiresAt },
      select: { id: true },
    });
    return this.composeToken(record.id, secret);
  }

  async consumeEmailToken(token: string) {
    const parsed = this.parseToken(token);
    if (!parsed) return null;
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { id: parsed.id } });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      return null;
    }
    const valid = await argon2.verify(record.tokenHash, parsed.secret).catch(() => false);
    if (!valid) return null;
    await this.prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return record.userId;
  }

  async createResetToken(userId: string, ttlMs: number) {
    const secret = this.generateSecret();
    const hash = await argon2.hash(secret, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ttlMs);
    const record = await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash: hash, expiresAt },
      select: { id: true },
    });
    return this.composeToken(record.id, secret);
  }

  async consumeResetToken(token: string) {
    const parsed = this.parseToken(token);
    if (!parsed) return null;
    const record = await this.prisma.passwordResetToken.findUnique({ where: { id: parsed.id } });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      return null;
    }
    const valid = await argon2.verify(record.tokenHash, parsed.secret).catch(() => false);
    if (!valid) return null;
    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return record.userId;
  }

  private generateSecret() {
    return randomBytes(32).toString('hex');
  }

  private composeToken(id: string, secret: string) {
    return `${id}.${secret}`;
  }

  private parseToken(token: string) {
    const [id, secret] = token.split('.', 2);
    if (!id || !secret) return null;
    return { id, secret };
  }
}
