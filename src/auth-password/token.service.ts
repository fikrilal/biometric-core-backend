import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';

@Injectable()
export class TokenService {
  private accessSecret: Uint8Array;
  private refreshSecret: Uint8Array;
  private accessTtlSeconds: number;
  private refreshTtlSeconds: number;

  constructor(private readonly config: ConfigService) {
    this.accessSecret = new TextEncoder().encode(this.config.getOrThrow<string>('AUTH_JWT_ACCESS_SECRET'));
    this.refreshSecret = new TextEncoder().encode(this.config.getOrThrow<string>('AUTH_JWT_REFRESH_SECRET'));
    this.accessTtlSeconds = this.parseDuration(this.config.get<string>('AUTH_JWT_ACCESS_TTL', '900'));
    this.refreshTtlSeconds = this.parseDuration(this.config.get<string>('AUTH_JWT_REFRESH_TTL', '604800'));
  }

  async signAccessToken(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.accessTtlSeconds;
    const token = await new SignJWT({ sub: userId, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.accessSecret);
    return { token, expiresIn: this.accessTtlSeconds };
  }

  async signRefreshToken(userId: string, tokenId: string) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.refreshTtlSeconds;
    const token = await new SignJWT({ sub: userId, jti: tokenId, type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.refreshSecret);
    return { token, expiresIn: this.refreshTtlSeconds };
  }

  async verifyAccessToken(token: string) {
    const result = await jwtVerify(token, this.accessSecret);
    return result.payload;
  }

  async verifyRefreshToken(token: string) {
    const result = await jwtVerify(token, this.refreshSecret);
    return result.payload;
  }

  private parseDuration(value: string): number {
    if (/^[0-9]+$/.test(value)) {
      return Number(value);
    }
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error('Invalid duration format');
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return amount * multiplier;
  }
}
