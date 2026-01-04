import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google ID token (OIDC)', minLength: 1 })
  @IsString()
  idToken!: string;
}

