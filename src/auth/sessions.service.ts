import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/errors/problem.exception';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async revokeAllForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { revoked: true },
    });
  }
}
