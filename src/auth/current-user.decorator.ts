import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FastifyRequest['user'] => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return request.user;
  },
);
