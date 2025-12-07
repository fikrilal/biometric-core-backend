import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransferRecipientDto } from './recipient.dto';

export class CreateTransferDto {
  @ApiProperty({ type: TransferRecipientDto })
  @ValidateNested()
  @Type(() => TransferRecipientDto)
  recipient!: TransferRecipientDto;

  @ApiProperty({ description: 'Amount in minor units', minimum: 1 })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ description: 'Currency code (e.g. IDR)' })
  @IsNotEmpty()
  @IsString()
  currency!: string;

  @ApiPropertyOptional({ description: 'Optional transfer note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Client-provided reference for idempotency' })
  @IsOptional()
  @IsString()
  clientReference?: string;

  @ApiPropertyOptional({
    description: 'Step-up token (optional if provided via X-Step-Up-Token header)',
  })
  @IsOptional()
  @IsString()
  stepUpToken?: string;
}
