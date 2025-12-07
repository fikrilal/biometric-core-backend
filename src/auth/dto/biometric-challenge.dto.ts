import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class BiometricChallengeDto {
  @ApiPropertyOptional({ description: 'User email to authenticate' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'User id to authenticate' })
  @IsOptional()
  @IsString()
  userId?: string;
}

