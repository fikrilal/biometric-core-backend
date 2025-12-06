import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server/esm/types';

export class StepUpVerifyDto {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'WebAuthn assertion response from the client',
  })
  @IsObject()
  credential!: AuthenticationResponseJSON;
}
