import { ApiProperty } from '@nestjs/swagger';

export class AuthUserResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ description: 'Whether the user has verified their email' })
  emailVerified!: boolean;
}

export class AuthTokensResponse {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ description: 'Access token TTL in seconds' })
  expiresIn!: number;
}

export class AuthSessionResponse {
  @ApiProperty({ type: AuthTokensResponse })
  tokens!: AuthTokensResponse;

  @ApiProperty({ type: AuthUserResponse })
  user!: AuthUserResponse;
}
