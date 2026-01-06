import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface FirebaseIdTokenClaims extends JWTPayload {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  firebase?: {
    sign_in_provider?: string;
    [key: string]: unknown;
  };
}

export class FirebaseAuthMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseAuthMisconfiguredError';
  }
}

@Injectable()
export class FirebaseAuthService {
  private readonly jwks = createRemoteJWKSet(
    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
  );

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(idToken: string): Promise<FirebaseIdTokenClaims> {
    const projectId = (this.config.get<string>('FIREBASE_PROJECT_ID') ?? '').trim();
    if (!projectId) {
      throw new FirebaseAuthMisconfiguredError('FIREBASE_PROJECT_ID is not configured');
    }

    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    return payload as FirebaseIdTokenClaims;
  }
}


