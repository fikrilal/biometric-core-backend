import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type GenerateAuthenticationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type VerifyAuthenticationResponseOpts,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
  type Base64URLString,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { WebauthnSignCountMode } from '../config/env.validation';

export interface WebAuthnUserDescriptor {
  id: string;
  email: string;
  displayName?: string;
}

export interface WebAuthnExistingCredential {
  credentialId: string;
  transports?: string[] | null;
}

export interface WebAuthnRegistrationResult {
  credentialID: Base64URLString;
  credentialPublicKey: Uint8Array;
  signCount: number;
  aaguid: string;
}

export interface WebAuthnAuthenticationResult {
  credentialID: Base64URLString;
  newSignCount: number;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private readonly rpId: string;
  private readonly rpName: string;
  private readonly origins: string[];
  private readonly challengeTtlMs: number;
  private readonly signCountMode: WebauthnSignCountMode;

  constructor(private readonly config: ConfigService) {
    this.rpId = this.config.getOrThrow<string>('WEBAUTHN_RP_ID');
    this.rpName = this.config.get<string>('WEBAUTHN_RP_NAME') ?? 'Biometric Core';
    const originsRaw = this.config.get<string>('WEBAUTHN_ORIGINS') ?? '';
    this.origins = originsRaw
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    this.challengeTtlMs = this.config.get<number>('WEBAUTHN_CHALLENGE_TTL_MS', 180000);
    this.signCountMode =
      this.config.get<WebauthnSignCountMode>('WEBAUTHN_SIGNCOUNT_MODE') ??
      WebauthnSignCountMode.Strict;
  }

  getChallengeTtlMs() {
    return this.challengeTtlMs;
  }

  getSignCountMode() {
    return this.signCountMode;
  }

  async generateRegistrationOptionsForUser(
    user: WebAuthnUserDescriptor,
    existingCredentials: WebAuthnExistingCredential[],
    options?: Partial<GenerateRegistrationOptionsOpts>,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const excludeCredentials = existingCredentials.map((cred) => ({
      id: cred.credentialId as Base64URLString,
      transports: this.parseTransports(cred.transports),
    }));

    return generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: user.email,
      userID: this.toUint8Array(user.id),
      userDisplayName: user.displayName ?? user.email,
      attestationType: 'none',
      excludeCredentials,
      ...(options ?? {}),
    });
  }

  async verifyRegistration(
    response: RegistrationResponseJSON,
    expectedChallenge: string,
  ): Promise<WebAuthnRegistrationResult | null> {
    const opts: VerifyRegistrationResponseOpts = {
      response,
      expectedChallenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpId,
    };

    const verification = await verifyRegistrationResponse(opts);
    if (!verification.verified || !verification.registrationInfo) {
      this.logger.warn('WebAuthn registration verification failed');
      return null;
    }

    const { credential, aaguid } = verification.registrationInfo;
    return {
      credentialID: credential.id,
      credentialPublicKey: credential.publicKey,
      signCount: credential.counter,
      aaguid,
    };
  }

  async generateAuthenticationOptionsForUser(
    credentials: WebAuthnExistingCredential[],
    options?: Partial<GenerateAuthenticationOptionsOpts>,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const allowCredentials = credentials.map((cred) => ({
      id: cred.credentialId as Base64URLString,
      transports: this.parseTransports(cred.transports),
    }));

    return generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials: allowCredentials.length ? allowCredentials : undefined,
      userVerification: 'required',
      ...(options ?? {}),
    });
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    credential: WebAuthnCredential,
  ): Promise<WebAuthnAuthenticationResult | null> {
    const opts: VerifyAuthenticationResponseOpts = {
      response,
      expectedChallenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpId,
      credential,
    };

    const verification = await verifyAuthenticationResponse(opts);
    if (!verification.verified) {
      this.logger.warn('WebAuthn authentication verification failed');
      return null;
    }

    return {
      credentialID: verification.authenticationInfo.credentialID,
      newSignCount: verification.authenticationInfo.newCounter,
    };
  }

  /**
   * Convert a UTF-8 string to Uint8Array for userID.
  */
  private toUint8Array(value: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
  }

  private parseTransports(
    value: string[] | null | undefined,
  ): AuthenticatorTransportFuture[] | undefined {
    if (!value || !value.length) {
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
    const transports = value.filter((t): t is AuthenticatorTransportFuture =>
      allowed.includes(t as AuthenticatorTransportFuture),
    );
    return transports.length ? transports : undefined;
  }
}
