import { ApiProperty } from '@nestjs/swagger';

export class StepUpVerifyResponse {
  @ApiProperty()
  stepUpToken!: string;
}

