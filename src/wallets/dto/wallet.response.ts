import { ApiProperty } from '@nestjs/swagger';
import { WalletStatus } from '@prisma/client';

class WalletLimitsDto {
  @ApiProperty()
  minAmountMinor!: number;

  @ApiProperty()
  perTransactionMaxMinor!: number;

  @ApiProperty()
  dailyMaxMinor!: number;

  @ApiProperty()
  dailyUsedMinor!: number;
}

export class WalletResponse {
  @ApiProperty()
  walletId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  availableBalanceMinor!: number;

  @ApiProperty({ enum: WalletStatus })
  status!: WalletStatus;

  @ApiProperty({ type: WalletLimitsDto })
  limits!: WalletLimitsDto;
}
