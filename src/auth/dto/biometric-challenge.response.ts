import { ApiProperty } from '@nestjs/swagger';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server/esm/types';

export class BiometricChallengeResponse {
  @ApiProperty()
  challengeId!: string;

  @ApiProperty({ type: 'object' })
  publicKeyCredentialOptions!: PublicKeyCredentialRequestOptionsJSON;
}

