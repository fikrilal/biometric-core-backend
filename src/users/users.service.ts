import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ProblemException } from '../common/errors/problem.exception';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
import { toPaginated } from '../common/pagination/pagination.util';
import { UserResponse } from './dto/user.response';

interface UserCursor {
  id: string;
}

type DbUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: Date;
};

@Injectable()
export class UsersService {
  private readonly defaultLimit = 25;

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<UserResponse> {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
      return this.toResponse(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw ProblemException.conflict('Email already exists');
      }
      throw error;
    }
  }

  async findAll(cursor?: string, limit?: number) {
    const take = Math.min(limit ?? this.defaultLimit, 250);
    const decoded = decodeCursor<UserCursor>(cursor);
    const users = await this.prisma.user.findMany({
      take: take + 1,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      ...(decoded
        ? {
            skip: 1,
            cursor: { id: decoded.id },
          }
        : {}),
    });

    let nextCursor: string | undefined;
    if (users.length > take) {
      const next = users.pop();
      if (next) {
        nextCursor = encodeCursor({ id: next.id });
      }
    }

    const mapped = users.map((u) => this.toResponse(u));
    return toPaginated(mapped, nextCursor, take);
  }

  async findOne(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }
    return this.toResponse(user);
  }

  private toResponse(user: DbUser): UserResponse {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      createdAt: user.createdAt,
    };
  }
}
