import { ApiProperty } from '@nestjs/swagger';

export class DeviceResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  credentialId!: string;

  @ApiProperty({ required: false, nullable: true })
  label!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

