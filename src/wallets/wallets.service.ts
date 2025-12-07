import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WalletStatus,
  WalletTransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletResponse } from './dto/wallet.response';
import { WalletTransactionResponse } from './dto/wallet-transaction.response';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
import { toPaginated } from '../common/pagination/pagination.util';

interface WalletTransactionCursor {
  id: string;
}

type TransactionWithUsers = Prisma.WalletTransactionGetPayload<{
  include: {
    fromWallet: {
      include: {
        user: {
          select: {
            id: true;
            firstName: true;
            lastName: true;
            email: true;
          };
        };
      };
    };
    toWallet: {
      include: {
        user: {
          select: {
            id: true;
            firstName: true;
            lastName: true;
            email: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class WalletsService {
  private readonly defaultCurrency: string;
  private readonly transferMinAmount: number;
  private readonly transferMaxAmount: number;
  private readonly transferAbsoluteMax: number;
  private readonly transferEffectiveMax: number;
  private readonly transferDailyLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.defaultCurrency = this.config.get<string>('WALLET_DEFAULT_CURRENCY', 'IDR');
    this.transferMinAmount = this.config.get<number>('TRANSFER_MIN_AMOUNT_MINOR', 1000);
    this.transferMaxAmount = this.config.get<number>('TRANSFER_MAX_AMOUNT_MINOR', 50_000_000);
    this.transferAbsoluteMax = this.config.get<number>('TRANSFER_ABSOLUTE_MAX_MINOR', 100_000_000);
    this.transferEffectiveMax = Math.min(this.transferMaxAmount, this.transferAbsoluteMax);
    this.transferDailyLimit = this.config.get<number>('TRANSFER_DAILY_LIMIT_MINOR', 200_000_000);
  }

  async getWalletView(userId: string): Promise<WalletResponse> {
    const wallet = await this.getOrCreateWalletForUser(userId);
    const dailyUsedMinor = await this.sumOutgoingForToday(wallet.id);

    return {
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      availableBalanceMinor: Number(wallet.availableBalanceMinor),
      status: wallet.status,
      limits: {
        minAmountMinor: this.transferMinAmount,
        perTransactionMaxMinor: this.transferEffectiveMax,
        dailyMaxMinor: this.transferDailyLimit,
        dailyUsedMinor,
      },
    };
  }

  async getTransactionsForUser(userId: string, cursor?: string, limit?: number) {
    const wallet = await this.getOrCreateWalletForUser(userId);
    const take = Math.min(limit ?? 25, 250);
    const decoded = decodeCursor<WalletTransactionCursor>(cursor);

    const transactions = await this.prisma.walletTransaction.findMany({
      where: {
        OR: [{ fromWalletId: wallet.id }, { toWalletId: wallet.id }],
      },
      include: {
        fromWallet: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        toWallet: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: take + 1,
      ...(decoded
        ? {
            cursor: { id: decoded.id },
            skip: 1,
          }
        : {}),
    });

    let nextCursor: string | undefined;
    if (transactions.length > take) {
      const next = transactions.pop();
      if (next) {
        nextCursor = encodeCursor({ id: next.id });
      }
    }

    const items = transactions.map((tx) => this.toTransactionResponse(tx, wallet.id));
    return toPaginated(items, nextCursor, take);
  }

  async getOrCreateWalletForUser(userId: string) {
    return this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        currency: this.defaultCurrency,
        status: WalletStatus.ACTIVE,
        availableBalanceMinor: BigInt(0),
      },
    });
  }

  private async sumOutgoingForToday(walletId: string): Promise<number> {
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const aggregate = await this.prisma.walletTransaction.aggregate({
      _sum: { amountMinor: true },
      where: {
        fromWalletId: walletId,
        status: WalletTransactionStatus.COMPLETED,
        createdAt: {
          gte: dayStart,
        },
      },
    });
    const sum = aggregate._sum.amountMinor ?? BigInt(0);
    return Number(sum);
  }

  private toTransactionResponse(
    tx: TransactionWithUsers,
    walletId: string,
  ): WalletTransactionResponse {
    const direction = tx.fromWalletId === walletId ? 'OUTGOING' : 'INCOMING';
    const counterpartyUser =
      direction === 'OUTGOING' ? tx.toWallet?.user : tx.fromWallet?.user;
    const amountMinor = Number(tx.amountMinor);
    const feeMinor = Number(tx.feeMinor);

    return {
      transactionId: tx.id,
      type: tx.type,
      direction,
      counterpartyUserId: counterpartyUser?.id ?? null,
      counterpartyMaskedName: this.maskName(counterpartyUser),
      counterpartyMaskedIdentifier: this.maskEmail(counterpartyUser?.email),
      amountMinor,
      feeMinor,
      currency: tx.currency,
      note: tx.note ?? null,
      status: tx.status,
      createdAt: tx.createdAt,
      stepUpUsed: tx.stepUpUsed,
    };
  }

  private maskName(user?: { firstName: string | null; lastName: string | null } | null) {
    if (!user) return null;
    const first = user.firstName?.trim();
    const lastInitial = user.lastName?.trim()?.charAt(0);
    if (first) {
      return lastInitial ? `${first} ${lastInitial}.` : first;
    }
    return null;
  }

  private maskEmail(email?: string | null) {
    if (!email) return null;
    const [local, domain] = email.split('@');
    if (!domain) return email;
    const visible = local.slice(0, Math.min(local.length, 3));
    return `${visible}***@${domain}`;
  }
}
