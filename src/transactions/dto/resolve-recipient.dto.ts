import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ResolveIdentifierDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class ResolveRecipientDto {
  @ApiProperty({ type: ResolveIdentifierDto })
  @ValidateNested()
  @Type(() => ResolveIdentifierDto)
  identifier!: ResolveIdentifierDto;
}

export class ResolveRecipientResponse {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  maskedIdentifier!: string;

  @ApiProperty()
  canReceiveTransfers!: boolean;
}
