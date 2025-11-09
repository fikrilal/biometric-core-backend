import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class ResetConfirmDto {
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  token!: string;

  @MinLength(8)
  newPassword!: string;
}
