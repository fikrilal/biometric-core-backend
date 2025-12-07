import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TokenService } from '../auth-password/token.service';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authHeader = request.headers['authorization'] ?? request.headers['Authorization'];
    if (!authHeader || Array.isArray(authHeader)) {
      throw new ProblemException(401, {
        title: 'Unauthorized',
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new ProblemException(401, {
        title: 'Unauthorized',
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    try {
      const payload = await this.tokens.verifyAccessToken(token);
      if (payload.type !== 'access' || typeof payload.sub !== 'string') {
        throw new Error('Invalid token payload');
      }

      request.user = { userId: payload.sub, tokenPayload: payload };
      return true;
    } catch {
      throw new ProblemException(401, {
        title: 'Invalid access token',
        code: ErrorCode.UNAUTHORIZED,
      });
    }
  }
}
