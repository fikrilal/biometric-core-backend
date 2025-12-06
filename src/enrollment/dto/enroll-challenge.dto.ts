import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EnrollChallengeDto {
  @ApiPropertyOptional({
    description: 'Optional human-friendly label for the device being enrolled',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceName?: string;
}

