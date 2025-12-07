import { ApiProperty } from '@nestjs/swagger';
import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

export class TransferResponse {
  @ApiProperty()
  transactionId!: string;

  @ApiProperty({ enum: WalletTransactionType })
  type!: WalletTransactionType;

  @ApiProperty({ enum: ['SENDER', 'RECIPIENT'] })
  role!: 'SENDER' | 'RECIPIENT';

  @ApiProperty()
  fromWalletId!: string;

  @ApiProperty()
  toWalletId!: string;

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

  @ApiProperty({ required: false })
  clientReference?: string | null;
}
