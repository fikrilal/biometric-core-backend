import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { RegistrationResponseJSON } from '@simplewebauthn/server/esm/types';

export class EnrollVerifyDto {
  @ApiProperty()
  @IsString()
  challengeId!: string;

  @ApiProperty({ type: 'object' })
  credential!: RegistrationResponseJSON;
}

