import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StepUpChallengeDto {
  @ApiPropertyOptional({
    description: 'Purpose for the step-up authentication (e.g., transaction:transfer)',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  purpose?: string;
}

