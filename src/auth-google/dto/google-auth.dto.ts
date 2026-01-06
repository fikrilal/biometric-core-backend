import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Firebase ID token (Google provider)', minLength: 1 })
  @IsString()
  @MinLength(1)
  idToken!: string;
}
