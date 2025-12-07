import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @MinLength(8)
  password!: string;

  @IsNotEmpty()
  firstName!: string;

  @IsNotEmpty()
  lastName!: string;
}
