import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WebAuthnService } from '../webauthn/webauthn.service';
import { RateLimiterService } from '../common/rate-limiter/rate-limiter.service';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { EnrollChallengeResponse } from './dto/enroll-challenge.response';
import { EnrollVerifyResponse } from './dto/enroll-verify.response';
import type { EnrollChallengeDto } from './dto/enroll-challenge.dto';
import type { EnrollVerifyDto } from './dto/enroll-verify.dto';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server/esm/types';
import { randomUUID } from 'crypto';

interface EnrollmentChallengeState {
  context: 'enroll';
  userId: string;
  email: string;
  deviceName?: string;
  options: PublicKeyCredentialCreationOptionsJSON;
  createdAt: number;
}

@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly webauthn: WebAuthnService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async createChallenge(userId: string, dto: EnrollChallengeDto, ip?: string): Promise<EnrollChallengeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }
    if (!user.emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Please verify your email before enrolling a device.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    await this.rateLimiter.consume({
      key: this.buildRateLimitKey(user.id, ip),
      limit: 10,
      ttlMs: 60 * 1000,
    });

    const existingCredentials = await this.prisma.credential.findMany({
      where: { userId: user.id, revoked: false },
      select: { credentialId: true, transports: true },
    });

    const webAuthnUser = {
      id: user.id,
      email: user.email,
      displayName: this.buildDisplayName(user.firstName, user.lastName, user.email),
    };

    const options = await this.webauthn.generateRegistrationOptionsForUser(
      webAuthnUser,
      existingCredentials.map((c) => ({
        credentialId: c.credentialId,
        transports: this.parseTransports(c.transports),
      })),
    );

    const challengeId = randomUUID();
    const state: EnrollmentChallengeState = {
      context: 'enroll',
      userId: user.id,
      email: user.email,
      deviceName: dto.deviceName,
      options,
      createdAt: Date.now(),
    };

    const ttlMs = this.webauthn.getChallengeTtlMs();
    const client = this.redis.getClient();
    await client.set(this.buildChallengeKey(challengeId), JSON.stringify(state), 'PX', ttlMs);

    return {
      challengeId,
      publicKeyCredentialOptions: options,
    };
  }

  async verifyEnrollment(dto: EnrollVerifyDto): Promise<EnrollVerifyResponse> {
    const client = this.redis.getClient();
    const key = this.buildChallengeKey(dto.challengeId);
    const raw = await client.get(key);

    if (!raw) {
      throw new ProblemException(404, {
        title: 'Enrollment challenge not found',
        code: ErrorCode.CHALLENGE_EXPIRED,
      });
    }

    await client.del(key);

    let state: EnrollmentChallengeState;
    try {
      state = JSON.parse(raw) as EnrollmentChallengeState;
    } catch {
      throw new ProblemException(500, {
        title: 'Invalid enrollment challenge state',
        code: ErrorCode.INTERNAL,
      });
    }

    const ttlMs = this.webauthn.getChallengeTtlMs();
    if (Date.now() - state.createdAt > ttlMs) {
      throw new ProblemException(404, {
        title: 'Enrollment challenge expired',
        code: ErrorCode.CHALLENGE_EXPIRED,
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: state.userId } });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }

    const registration = await this.webauthn.verifyRegistration(dto.credential, state.options.challenge);
    if (!registration) {
      throw new ProblemException(400, {
        title: 'Invalid attestation response',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }

    const existing = await this.prisma.credential.findUnique({
      where: { credentialId: registration.credentialID },
      select: { userId: true },
    });

    if (existing && existing.userId !== user.id) {
      throw new ProblemException(409, {
        title: 'Credential already registered',
        code: ErrorCode.CONFLICT,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const credential = await tx.credential.upsert({
        where: { credentialId: registration.credentialID },
        update: {
          userId: user.id,
          publicKey: Buffer.from(registration.credentialPublicKey),
          signCount: registration.signCount ?? 0,
          aaguid: registration.aaguid,
          deviceName: state.deviceName,
          revoked: false,
          revokedAt: null,
        },
        create: {
          userId: user.id,
          credentialId: registration.credentialID,
          publicKey: Buffer.from(registration.credentialPublicKey),
          signCount: registration.signCount ?? 0,
          aaguid: registration.aaguid,
          deviceName: state.deviceName,
        },
      });

      const device = await tx.device.create({
        data: {
          userId: user.id,
          credentialId: credential.credentialId,
          label: state.deviceName,
          active: true,
        },
      });

      return { credential, device };
    });

    return {
      credentialId: created.credential.credentialId,
      deviceId: created.device.id,
    };
  }

  private buildRateLimitKey(userId: string, ip?: string) {
    const normalizedIp = ip ?? 'unknown';
    return `rl:enroll-challenge:${userId}:${normalizedIp}`;
  }

  private buildChallengeKey(challengeId: string) {
    return `webauthn:enroll:challenge:${challengeId}`;
  }

  private buildDisplayName(firstName: string, lastName: string, email: string) {
    const fullName = `${firstName ?? ''} ${lastName ?? ''}`.trim();
    return fullName || email;
  }

  private parseTransports(value: string | null) {
    if (!value) {
      return undefined;
    }
    return value.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  }
}
