import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class TransferRecipientDto {
  @ApiPropertyOptional({ description: 'Recipient user id' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Recipient email address' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
