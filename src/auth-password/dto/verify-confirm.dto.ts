import { IsNotEmpty } from 'class-validator';

export class VerifyConfirmDto {
  @IsNotEmpty()
  token!: string;
}
