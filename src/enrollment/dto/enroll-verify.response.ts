import { ApiProperty } from '@nestjs/swagger';

export class EnrollVerifyResponse {
  @ApiProperty()
  credentialId!: string;

  @ApiProperty()
  deviceId!: string;
}

