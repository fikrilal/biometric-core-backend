import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';

@Injectable()
export class PendingTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async createEmailToken(userId: string, ttlMs: number) {
    return this.createTokenRecord(this.prisma.emailVerificationToken, userId, ttlMs);
  }

  async consumeEmailToken(token: string) {
    return this.consumeTokenRecord(this.prisma.emailVerificationToken, token);
  }

  async createResetToken(userId: string, ttlMs: number) {
    return this.createTokenRecord(this.prisma.passwordResetToken, userId, ttlMs);
  }

  async consumeResetToken(token: string) {
    return this.consumeTokenRecord(this.prisma.passwordResetToken, token);
  }

  private async createTokenRecord(
    delegate: PrismaService['emailVerificationToken'] | PrismaService['passwordResetToken'],
    userId: string,
    ttlMs: number,
  ) {
    const secret = this.generateSecret();
    const hash = await argon2.hash(secret, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + ttlMs);
    const record = await delegate.create({
      data: { userId, tokenHash: hash, expiresAt },
      select: { id: true },
    });
    return this.composeToken(record.id, secret);
  }

  private async consumeTokenRecord(
    delegate: PrismaService['emailVerificationToken'] | PrismaService['passwordResetToken'],
    token: string,
  ) {
    const parsed = this.parseToken(token);
    if (!parsed) return null;
    const record = await delegate.findUnique({ where: { id: parsed.id } });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      return null;
    }
    const valid = await argon2.verify(record.tokenHash, parsed.secret).catch(() => false);
    if (!valid) return null;
    await delegate.update({
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
