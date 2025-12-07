import 'fastify';
import type { JWTPayload } from 'jose';

declare module 'fastify' {
  interface FastifyRequest {
    requestId?: string;
    user?: {
      userId: string;
      tokenPayload: JWTPayload;
    };
  }
}
