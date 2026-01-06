import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface GoogleIdTokenClaims extends JWTPayload {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
}

export class GoogleOidcMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleOidcMisconfiguredError';
  }
}

@Injectable()
export class GoogleOidcService {
  private readonly jwks = createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
  );

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(idToken: string): Promise<GoogleIdTokenClaims> {
    const clientIdsRaw = this.config.get<string>('GOOGLE_OIDC_CLIENT_IDS') ?? '';
    const audiences = clientIdsRaw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    if (audiences.length === 0) {
      throw new GoogleOidcMisconfiguredError('GOOGLE_OIDC_CLIENT_IDS is not configured');
    }

    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: audiences,
    });

    return payload as GoogleIdTokenClaims;
  }
}
