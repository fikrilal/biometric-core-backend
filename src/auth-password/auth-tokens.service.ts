import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';
import { AuthTokensResponse } from './dto/auth.response';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';

export interface AuthTokenUser {
  id: string;
  emailVerified: boolean;
}

@Injectable()
export class AuthTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async issueTokensForUser(user: AuthTokenUser): Promise<AuthTokensResponse> {
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
}

