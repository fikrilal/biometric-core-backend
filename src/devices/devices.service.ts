import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/errors/problem.exception';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
import { toPaginated } from '../common/pagination/pagination.util';
import { DeviceResponse } from './dto/device.response';

interface DeviceCursor {
  createdAt: string;
  id: string;
}

@Injectable()
export class DevicesService {
  private readonly defaultLimit = 25;

  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, cursor?: string, limit?: number) {
    const take = Math.min(limit ?? this.defaultLimit, 250);
    const decoded = decodeCursor<DeviceCursor>(cursor);

    const devices = await this.prisma.device.findMany({
      where: { userId },
      take: take + 1,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      ...(decoded
        ? {
            skip: 1,
            cursor: {
              id: decoded.id,
            },
          }
        : {}),
    });

    let nextCursor: string | undefined;
    if (devices.length > take) {
      const next = devices.pop();
      if (next) {
        nextCursor = encodeCursor<DeviceCursor>({
          id: next.id,
          createdAt: next.createdAt.toISOString(),
        });
      }
    }

    const mapped = devices.map<DeviceResponse>((d) => ({
      id: d.id,
      userId: d.userId,
      credentialId: d.credentialId,
      label: d.label ?? null,
      active: d.active,
      createdAt: d.createdAt,
    }));

    return toPaginated(mapped, nextCursor, take);
  }

  async revoke(userId: string, id: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device || device.userId !== userId) {
      throw ProblemException.notFound('Device not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id: device.id },
        data: {
          active: false,
          deactivatedAt: new Date(),
          deactivatedReason: 'user_revoked',
        },
      });

      await tx.credential.updateMany({
        where: { credentialId: device.credentialId },
        data: {
          revoked: true,
          revokedAt: new Date(),
        },
      });
    });
  }
}

