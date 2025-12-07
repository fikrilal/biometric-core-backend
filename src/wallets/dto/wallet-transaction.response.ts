import { ApiProperty } from '@nestjs/swagger';
import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

export class WalletTransactionResponse {
  @ApiProperty()
  transactionId!: string;

  @ApiProperty({ enum: WalletTransactionType })
  type!: WalletTransactionType;

  @ApiProperty({ enum: ['INCOMING', 'OUTGOING'] })
  direction!: 'INCOMING' | 'OUTGOING';

  @ApiProperty({ nullable: true })
  counterpartyUserId!: string | null;

  @ApiProperty({ nullable: true })
  counterpartyMaskedName!: string | null;

  @ApiProperty({ nullable: true })
  counterpartyMaskedIdentifier!: string | null;

  @ApiProperty()
  amountMinor!: number;

  @ApiProperty()
  feeMinor!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ required: false, nullable: true })
  note!: string | null;

  @ApiProperty({ enum: WalletTransactionStatus })
  status!: WalletTransactionStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty()
  stepUpUsed!: boolean;
}
