import { ApiProperty } from '@nestjs/swagger';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';

export class StepUpChallengeResponse {
  @ApiProperty()
  challengeId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'WebAuthn authentication options for step-up (opaque to the client)',
  })
  publicKeyCredentialOptions!: PublicKeyCredentialRequestOptionsJSON;
}
