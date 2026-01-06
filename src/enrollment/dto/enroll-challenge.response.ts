import { ApiProperty } from '@nestjs/swagger';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';

export class EnrollChallengeResponse {
  @ApiProperty()
  challengeId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'WebAuthn registration options (opaque to the client)',
  })
  publicKeyCredentialOptions!: PublicKeyCredentialCreationOptionsJSON;
}
