import { IsNotEmpty, MinLength } from 'class-validator';

export class ResetConfirmDto {
  @IsNotEmpty()
  token!: string;

  @MinLength(8)
  newPassword!: string;
}
