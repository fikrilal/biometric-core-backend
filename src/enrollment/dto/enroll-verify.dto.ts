import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';
import type { RegistrationResponseJSON } from '@simplewebauthn/server/esm/types';

export class EnrollVerifyDto {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'WebAuthn attestation response from the client',
  })
  @IsObject()
  credential!: RegistrationResponseJSON;
}
