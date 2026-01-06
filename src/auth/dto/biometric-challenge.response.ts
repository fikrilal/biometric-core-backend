import { ApiProperty } from '@nestjs/swagger';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';

export class BiometricChallengeResponse {
  @ApiProperty()
  challengeId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'WebAuthn authentication options (opaque to the client)',
  })
  publicKeyCredentialOptions!: PublicKeyCredentialRequestOptionsJSON;
}
