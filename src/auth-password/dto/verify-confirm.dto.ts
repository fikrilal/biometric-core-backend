import { IsEmail, IsNotEmpty } from 'class-validator';

export class VerifyConfirmDto {
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  token!: string;
}
