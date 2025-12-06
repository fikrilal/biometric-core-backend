import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WebAuthnService } from '../webauthn/webauthn.service';
import { RateLimiterService } from '../common/rate-limiter/rate-limiter.service';
import { AuthTokensService } from '../auth-password/auth-tokens.service';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { BiometricChallengeDto } from './dto/biometric-challenge.dto';
import type { BiometricChallengeResponse } from './dto/biometric-challenge.response';
import type { BiometricVerifyDto } from './dto/biometric-verify.dto';
import type { AuthTokensResponse } from '../auth-password/dto/auth.response';
import type {
  AuthenticatorTransportFuture,
  PublicKeyCredentialRequestOptionsJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server/esm/types';
import { randomUUID } from 'crypto';
import type { StepUpChallengeDto } from './dto/step-up-challenge.dto';
import type { StepUpChallengeResponse } from './dto/step-up-challenge.response';
import type { StepUpVerifyDto } from './dto/step-up-verify.dto';
import type { StepUpVerifyResponse } from './dto/step-up-verify.response';
import { TokenService } from '../auth-password/token.service';

interface AuthChallengeState {
  context: 'login';
  userId: string;
  email: string;
  options: PublicKeyCredentialRequestOptionsJSON;
  createdAt: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly webauthn: WebAuthnService,
    private readonly rateLimiter: RateLimiterService,
    private readonly authTokens: AuthTokensService,
    private readonly tokens: TokenService,
  ) {}

  ping() {
    return { ok: true };
  }

  async createBiometricLoginChallenge(
    dto: BiometricChallengeDto,
    ip?: string,
  ): Promise<BiometricChallengeResponse> {
    const user = await this.resolveUser(dto);
    await this.rateLimiter.consume({
      key: this.buildRateLimitKey(user.id, dto.email ?? dto.userId ?? 'unknown', ip),
      limit: 10,
      ttlMs: 60 * 1000,
    });

    const credentials = await this.prisma.credential.findMany({
      where: {
        userId: user.id,
        revoked: false,
        devices: { some: { active: true } },
      },
      select: { credentialId: true, transports: true },
    });

    if (!credentials.length) {
      throw new ProblemException(404, {
        title: 'No credentials for user',
        code: ErrorCode.NO_CREDENTIALS,
      });
    }

    const options = await this.webauthn.generateAuthenticationOptionsForUser(
      credentials.map((c) => ({
        credentialId: c.credentialId,
        transports: this.parseTransports(c.transports),
      })),
    );

    const challengeId = randomUUID();
    const state: AuthChallengeState = {
      context: 'login',
      userId: user.id,
      email: user.email,
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

  async verifyBiometricLogin(dto: BiometricVerifyDto): Promise<AuthTokensResponse> {
    const client = this.redis.getClient();
    const key = this.buildChallengeKey(dto.challengeId);
    const raw = await client.get(key);

    if (!raw) {
      throw new ProblemException(404, {
        title: 'Authentication challenge not found',
        code: ErrorCode.NOT_FOUND,
      });
    }

    await client.del(key);

    let state: AuthChallengeState;
    try {
      state = JSON.parse(raw) as AuthChallengeState;
    } catch {
      throw new ProblemException(500, {
        title: 'Invalid authentication challenge state',
        code: ErrorCode.INTERNAL,
      });
    }

    const ttlMs = this.webauthn.getChallengeTtlMs();
    if (Date.now() - state.createdAt > ttlMs) {
      throw new ProblemException(404, {
        title: 'Authentication challenge expired',
        code: ErrorCode.NOT_FOUND,
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: state.userId } });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }
    if (!user.emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Please verify your email before logging in.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    const credentialRecord = await this.prisma.credential.findUnique({
      where: { credentialId: dto.credential.id },
      select: {
        credentialId: true,
        userId: true,
        publicKey: true,
        signCount: true,
        revoked: true,
        transports: true,
        devices: { select: { active: true } },
      },
    });

    if (
      !credentialRecord ||
      credentialRecord.userId !== user.id ||
      credentialRecord.revoked ||
      !credentialRecord.devices.some((d) => d.active)
    ) {
      throw new ProblemException(401, {
        title: 'Credential not valid for user',
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    const webAuthnCredential: WebAuthnCredential = {
      id: credentialRecord.credentialId,
      publicKey: new Uint8Array(credentialRecord.publicKey),
      counter: credentialRecord.signCount,
      transports: this.parseTransports(credentialRecord.transports),
    };

    const verification = await this.webauthn.verifyAuthentication(
      dto.credential,
      state.options.challenge,
      webAuthnCredential,
    );

    if (!verification) {
      throw new ProblemException(400, {
        title: 'Invalid authentication response',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }

    const newCounter = verification.newSignCount;
    if (newCounter > credentialRecord.signCount) {
      await this.prisma.credential.update({
        where: { credentialId: credentialRecord.credentialId },
        data: { signCount: newCounter },
      });
    }

    return this.authTokens.issueTokensForUser(user);
  }

  private async resolveUser(dto: BiometricChallengeDto) {
    const hasEmail = !!dto.email;
    const hasUserId = !!dto.userId;
    if ((hasEmail && hasUserId) || (!hasEmail && !hasUserId)) {
      throw new ProblemException(400, {
        title: 'Either email or userId must be provided',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }

    const where = hasUserId
      ? { id: dto.userId as string }
      : { email: this.normalizeEmail(dto.email as string) };

    const user = await this.prisma.user.findUnique({ where });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }
    if (!user.emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Please verify your email before logging in.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }
    return user;
  }

  private buildRateLimitKey(userId: string, identifier: string, ip?: string) {
    const normalizedId = identifier || 'unknown';
    const normalizedIp = ip ?? 'unknown';
    return `rl:auth-challenge:login:${userId}:${normalizedId}:${normalizedIp}`;
  }

  private buildChallengeKey(challengeId: string) {
    return `webauthn:auth:challenge:${challengeId}`;
  }

  private parseTransports(
    value: string | null | undefined,
  ): AuthenticatorTransportFuture[] | undefined {
    if (!value) {
      return undefined;
    }
    const allowed: AuthenticatorTransportFuture[] = [
      'ble',
      'cable',
      'hybrid',
      'internal',
      'nfc',
      'smart-card',
      'usb',
    ];
    const transports = value
      .split(',')
      .map((t) => t.trim())
      .filter((t): t is AuthenticatorTransportFuture => allowed.includes(t as AuthenticatorTransportFuture));
    return transports.length ? transports : undefined;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  async createStepUpChallenge(
    userId: string,
    dto: StepUpChallengeDto,
    ip?: string,
  ): Promise<StepUpChallengeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }
    if (!user.emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Please verify your email before performing this action.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    await this.rateLimiter.consume({
      key: this.buildRateLimitKey(user.id, dto.purpose ?? 'step_up', ip),
      limit: 20,
      ttlMs: 60 * 1000,
    });

    const credentials = await this.prisma.credential.findMany({
      where: {
        userId: user.id,
        revoked: false,
        devices: { some: { active: true } },
      },
      select: { credentialId: true, transports: true },
    });

    if (!credentials.length) {
      throw new ProblemException(404, {
        title: 'No credentials for user',
        code: ErrorCode.NO_CREDENTIALS,
      });
    }

    const options = await this.webauthn.generateAuthenticationOptionsForUser(
      credentials.map((c) => ({
        credentialId: c.credentialId,
        transports: this.parseTransports(c.transports),
      })),
    );

    const challengeId = randomUUID();
    const state: AuthChallengeState = {
      context: 'login',
      userId: user.id,
      email: user.email,
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

  async verifyStepUp(userId: string, dto: StepUpVerifyDto): Promise<StepUpVerifyResponse> {
    const client = this.redis.getClient();
    const key = this.buildChallengeKey(dto.challengeId);
    const raw = await client.get(key);

    if (!raw) {
      throw new ProblemException(404, {
        title: 'Authentication challenge not found',
        code: ErrorCode.CHALLENGE_EXPIRED,
      });
    }

    await client.del(key);

    let state: AuthChallengeState;
    try {
      state = JSON.parse(raw) as AuthChallengeState;
    } catch {
      throw new ProblemException(500, {
        title: 'Invalid authentication challenge state',
        code: ErrorCode.INTERNAL,
      });
    }

    const ttlMs = this.webauthn.getChallengeTtlMs();
    if (Date.now() - state.createdAt > ttlMs) {
      throw new ProblemException(404, {
        title: 'Authentication challenge expired',
        code: ErrorCode.CHALLENGE_EXPIRED,
      });
    }

    if (state.userId !== userId) {
      throw new ProblemException(401, {
        title: 'Challenge does not belong to user',
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: state.userId } });
    if (!user) {
      throw ProblemException.notFound('User not found');
    }
    if (!user.emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Please verify your email before performing this action.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    const credentialRecord = await this.prisma.credential.findUnique({
      where: { credentialId: dto.credential.id },
      select: {
        credentialId: true,
        userId: true,
        publicKey: true,
        signCount: true,
        revoked: true,
        transports: true,
        devices: { select: { active: true } },
      },
    });

    if (
      !credentialRecord ||
      credentialRecord.userId !== user.id ||
      credentialRecord.revoked ||
      !credentialRecord.devices.some((d) => d.active)
    ) {
      throw new ProblemException(401, {
        title: 'Credential not valid for user',
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    const webAuthnCredential: WebAuthnCredential = {
      id: credentialRecord.credentialId,
      publicKey: new Uint8Array(credentialRecord.publicKey),
      counter: credentialRecord.signCount,
      transports: this.parseTransports(credentialRecord.transports),
    };

    const verification = await this.webauthn.verifyAuthentication(
      dto.credential,
      state.options.challenge,
      webAuthnCredential,
    );

    if (!verification) {
      throw new ProblemException(400, {
        title: 'Invalid authentication response',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }

    const newCounter = verification.newSignCount;
    if (newCounter > credentialRecord.signCount) {
      await this.prisma.credential.update({
        where: { credentialId: credentialRecord.credentialId },
        data: { signCount: newCounter },
      });
    }

    const stepUp = await this.tokens.signStepUpToken(user.id, undefined, dto.challengeId);
    return { stepUpToken: stepUp.token };
  }
}
