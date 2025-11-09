import { IsEmail } from 'class-validator';

export class VerifyRequestDto {
  @IsEmail()
  email!: string;
}
