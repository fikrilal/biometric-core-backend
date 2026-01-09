import { MinLength } from 'class-validator';

export class ChangePasswordDto {
  @MinLength(8)
  currentPassword!: string;

  @MinLength(8)
  newPassword!: string;
}
