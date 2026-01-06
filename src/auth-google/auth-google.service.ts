import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokensService } from '../auth-password/auth-tokens.service';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FirebaseAuthMisconfiguredError,
  FirebaseAuthService,
  type FirebaseIdTokenClaims,
} from './firebase-auth.service';
import { AuthProvider } from '@prisma/client';

@Injectable()
export class AuthGoogleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseAuthService,
    private readonly authTokens: AuthTokensService,
  ) {}

  async authenticate(idToken: string) {
    let claims: FirebaseIdTokenClaims;
    try {
      claims = await this.firebase.verifyIdToken(idToken);
    } catch (err) {
      if (err instanceof FirebaseAuthMisconfiguredError) {
        throw new ProblemException(500, {
          title: 'Google login is not configured',
          code: ErrorCode.INTERNAL,
        });
      }
      throw new ProblemException(401, {
        title: 'Invalid Google token',
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    const signInProvider = claims.firebase?.sign_in_provider;
    if (signInProvider !== 'google.com') {
      throw new ProblemException(403, {
        title: 'Forbidden',
        detail: 'Firebase token must be issued via Google Sign-In (google.com).',
        code: ErrorCode.FORBIDDEN,
      });
    }

    const providerAccountId = claims.sub;
    if (!providerAccountId) {
      throw new ProblemException(400, {
        title: 'Invalid Google token payload',
        detail: 'Missing subject (sub).',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }

    const email = this.normalizeEmail(claims.email);
    const emailVerified = claims.email_verified === true;
    if (!email) {
      throw new ProblemException(400, {
        title: 'Invalid Google token payload',
        detail: 'Missing email.',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }
    if (!emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Google account email must be verified.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    const existingLink = await this.prisma.authProviderAccount.findUnique({
      where: {
        provider_providerAccountId: { provider: AuthProvider.GOOGLE, providerAccountId },
      },
      include: { user: true },
    });

    const user =
      existingLink?.user ??
      (await this.findOrCreateUserAndLink({
        email,
        providerAccountId,
        firstName: this.extractFirstName(claims.name),
        lastName: this.extractLastName(claims.name),
      }));

    const tokens = await this.authTokens.issueTokensForUser(user);
    return { tokens, user: this.toUserResponse(user) };
  }

  async connect(userId: string, idToken: string): Promise<void> {
    let claims: FirebaseIdTokenClaims;
    try {
      claims = await this.firebase.verifyIdToken(idToken);
    } catch (err) {
      if (err instanceof FirebaseAuthMisconfiguredError) {
        throw new ProblemException(500, {
          title: 'Google login is not configured',
          code: ErrorCode.INTERNAL,
        });
      }
      throw new ProblemException(401, {
        title: 'Invalid Google token',
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    const signInProvider = claims.firebase?.sign_in_provider;
    if (signInProvider !== 'google.com') {
      throw new ProblemException(403, {
        title: 'Forbidden',
        detail: 'Firebase token must be issued via Google Sign-In (google.com).',
        code: ErrorCode.FORBIDDEN,
      });
    }

    const providerAccountId = claims.sub;
    if (!providerAccountId) {
      throw new ProblemException(400, {
        title: 'Invalid Google token payload',
        detail: 'Missing subject (sub).',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }

    const email = this.normalizeEmail(claims.email);
    const emailVerified = claims.email_verified === true;
    if (!email) {
      throw new ProblemException(400, {
        title: 'Invalid Google token payload',
        detail: 'Missing email.',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }
    if (!emailVerified) {
      throw new ProblemException(403, {
        title: 'Email not verified',
        detail: 'Google account email must be verified.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ProblemException.notFound('User not found');

    if (this.normalizeEmail(user.email) !== email) {
      throw new ProblemException(403, {
        title: 'Email mismatch',
        detail: 'Google account email must match the current user email.',
        code: ErrorCode.FORBIDDEN,
      });
    }

    const alreadyLinked = await this.prisma.authProviderAccount.findUnique({
      where: {
        provider_providerAccountId: { provider: AuthProvider.GOOGLE, providerAccountId },
      },
      select: { userId: true },
    });

    if (alreadyLinked && alreadyLinked.userId !== userId) {
      throw new ProblemException(403, {
        title: 'Forbidden',
        detail: 'Google account cannot be linked to this user.',
        code: ErrorCode.FORBIDDEN,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.authProviderAccount.upsert({
        where: { userId_provider: { userId, provider: AuthProvider.GOOGLE } },
        create: {
          userId,
          provider: AuthProvider.GOOGLE,
          providerAccountId,
          email,
        },
        update: {
          providerAccountId,
          email,
        },
      });

      if (!user.emailVerified) {
        await tx.user.update({ where: { id: userId }, data: { emailVerified: true } });
      }
    });
  }

  private async findOrCreateUserAndLink(input: {
    email: string;
    providerAccountId: string;
    firstName?: string;
    lastName?: string;
  }) {
    // Transaction to avoid races between user creation and provider linking.
    return this.prisma.$transaction(async (tx) => {
      const existingLink = await tx.authProviderAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: AuthProvider.GOOGLE,
            providerAccountId: input.providerAccountId,
          },
        },
        include: { user: true },
      });
      if (existingLink?.user) return existingLink.user;

      const existingUser = await tx.user.findUnique({ where: { email: input.email } });
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email: input.email,
            firstName: input.firstName ?? '',
            lastName: input.lastName ?? '',
            emailVerified: true,
          },
        }));

      await tx.authProviderAccount.create({
        data: {
          userId: user.id,
          provider: AuthProvider.GOOGLE,
          providerAccountId: input.providerAccountId,
          email: input.email,
        },
      });

      if (!user.emailVerified) {
        await tx.user.update({ where: { id: user.id }, data: { emailVerified: true } });
        return { ...user, emailVerified: true };
      }

      return user;
    });
  }

  private normalizeEmail(value?: string) {
    const email = (value ?? '').trim().toLowerCase();
    return email || null;
  }

  private extractFirstName(fullName?: string) {
    const raw = (fullName ?? '').trim();
    if (!raw) return undefined;
    return raw.split(/\s+/).slice(0, 1).join(' ');
  }

  private extractLastName(fullName?: string) {
    const raw = (fullName ?? '').trim();
    if (!raw) return undefined;
    const parts = raw.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(' ') : undefined;
  }

  private toUserResponse(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
  }) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
    };
  }
}
