import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google ID token (OIDC)', minLength: 1 })
  @IsString()
  @MinLength(1)
  idToken!: string;
}
