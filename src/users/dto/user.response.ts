import { ApiProperty } from '@nestjs/swagger';

export class UserResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
