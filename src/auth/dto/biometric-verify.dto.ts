import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server/esm/types';

export class BiometricVerifyDto {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty({ type: 'object' })
  credential!: AuthenticationResponseJSON;
}

