import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  Wallet,
  WalletTransaction,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponse } from './dto/transfer.response';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TokenService } from '../auth-password/token.service';
import { ResolveRecipientDto, ResolveRecipientResponse } from './dto/resolve-recipient.dto';

interface StepUpPayload {
  token?: string;
  headerToken?: string;
}

@Injectable()
export class TransactionsService {
  private readonly transferMinAmount: number;
  private readonly transferMaxAmount: number;
  private readonly transferDailyLimit: number;
  private readonly highValueThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly tokens: TokenService,
  ) {
    this.transferMinAmount = Number(process.env.TRANSFER_MIN_AMOUNT_MINOR ?? 1000);
    this.transferMaxAmount = Number(process.env.TRANSFER_MAX_AMOUNT_MINOR ?? 50_000_000);
    this.transferDailyLimit = Number(process.env.TRANSFER_DAILY_LIMIT_MINOR ?? 200_000_000);
    this.highValueThreshold = Number(
      process.env.HIGH_VALUE_TRANSFER_THRESHOLD_MINOR ?? 5_000_000,
    );
  }

  async resolveRecipient(dto: ResolveRecipientDto): Promise<ResolveRecipientResponse> {
    const identifier = dto.identifier;
    const where = this.buildRecipientWhere(identifier);
    if (!where) {
      throw ProblemException.notFound('Recipient not found');
    }
    const user = await this.prisma.user.findFirst({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        wallet: { select: { status: true } },
      },
    });
    if (!user || !user.wallet) {
      throw ProblemException.notFound('Recipient not found');
    }
    return {
      userId: user.id,
      displayName: this.buildDisplayName(user.firstName, user.lastName, user.email),
      maskedIdentifier: this.maskEmail(user.email),
      canReceiveTransfers: user.wallet.status !== 'CLOSED',
    };
  }

  async getTransactionForUser(userId: string, transactionId: string): Promise<TransferResponse> {
    const wallet = await this.wallets.getOrCreateWalletForUser(userId);
    const transaction = await this.prisma.walletTransaction.findFirst({
      where: {
        id: transactionId,
        OR: [{ fromWalletId: wallet.id }, { toWalletId: wallet.id }],
      },
    });
    if (!transaction) {
      throw ProblemException.notFound('Transaction not found');
    }
    const role = transaction.fromWalletId === wallet.id ? 'SENDER' : 'RECIPIENT';
    return this.toResponse(transaction, role);
  }

  async createTransfer(
    userId: string,
    dto: CreateTransferDto,
    stepUp: StepUpPayload,
  ): Promise<TransferResponse> {
    const senderWallet = await this.wallets.getOrCreateWalletForUser(userId);
    const recipientUser = await this.resolveRecipientUser(dto.recipient, userId);
    const recipientWallet = await this.wallets.getOrCreateWalletForUser(recipientUser.id);

    this.ensureWalletStatuses(senderWallet, recipientWallet);
    this.ensureCurrencyMatch(senderWallet, recipientWallet, dto.currency);

    const amount = BigInt(dto.amountMinor);
    this.ensureAmountWithinLimits(dto.amountMinor);

    const dailyTotal = await this.sumOutgoingForToday(senderWallet.id);
    if (dailyTotal + dto.amountMinor > this.transferDailyLimit) {
      throw new ProblemException(400, {
        title: 'Daily limit exceeded',
        code: ErrorCode.LIMIT_EXCEEDED,
      });
    }

    const senderBalance = BigInt(senderWallet.availableBalanceMinor);
    if (senderBalance < amount) {
      throw new ProblemException(400, {
        title: 'Insufficient funds',
        code: ErrorCode.INSUFFICIENT_FUNDS,
      });
    }

    const requiresStepUp = this.needsStepUp(dto.amountMinor, dailyTotal);
    if (requiresStepUp) {
      const token =
        stepUp.headerToken?.trim() || dto.stepUpToken?.trim();
      if (!token) {
        throw new ProblemException(401, {
          title: 'Step-up token required',
          code: ErrorCode.UNAUTHORIZED,
        });
      }
      await this.verifyStepUpToken(token, userId);
    }

    if (dto.clientReference) {
      const existing = await this.prisma.walletTransaction.findFirst({
        where: {
          fromWalletId: senderWallet.id,
          clientReference: dto.clientReference,
        },
      });
      if (existing) {
        this.ensureIdempotentMatch(existing, recipientWallet.id, dto);
        return this.toResponse(existing, 'SENDER');
      }
    }

    const transaction = await this.prisma.$transaction(async (tx) => {
      const currentSender = await tx.wallet.findUniqueOrThrow({
        where: { id: senderWallet.id },
      });
      const currentRecipient = await tx.wallet.findUniqueOrThrow({
        where: { id: recipientWallet.id },
      });
      const senderBalanceNow = BigInt(currentSender.availableBalanceMinor);
      if (senderBalanceNow < amount) {
        throw new ProblemException(400, {
          title: 'Insufficient funds',
          code: ErrorCode.INSUFFICIENT_FUNDS,
        });
      }
      const newSenderBalance = senderBalanceNow - amount;
      const recipientBalance = BigInt(currentRecipient.availableBalanceMinor);
      const newRecipientBalance = recipientBalance + amount;

      const created = await tx.walletTransaction.create({
        data: {
          type: WalletTransactionType.P2P_TRANSFER,
          status: WalletTransactionStatus.COMPLETED,
          fromWalletId: senderWallet.id,
          toWalletId: recipientWallet.id,
          amountMinor: amount,
          feeMinor: BigInt(0),
          currency: senderWallet.currency,
          note: dto.note,
          clientReference: dto.clientReference,
          stepUpUsed: requiresStepUp,
        },
      });

      await tx.walletLedgerEntry.createMany({
        data: [
          {
            transactionId: created.id,
            walletId: senderWallet.id,
            direction: 'DEBIT',
            amountMinor: amount,
            balanceAfterMinor: newSenderBalance,
          },
          {
            transactionId: created.id,
            walletId: recipientWallet.id,
            direction: 'CREDIT',
            amountMinor: amount,
            balanceAfterMinor: newRecipientBalance,
          },
        ],
      });

      await tx.wallet.update({
        where: { id: senderWallet.id },
        data: { availableBalanceMinor: newSenderBalance },
      });
      await tx.wallet.update({
        where: { id: recipientWallet.id },
        data: { availableBalanceMinor: newRecipientBalance },
      });

      return created;
    });

    return this.toResponse(transaction, 'SENDER');
  }

  private async resolveRecipientUser(
    recipient: CreateTransferDto['recipient'],
    senderUserId: string,
  ) {
    const where = this.buildRecipientWhere(recipient);
    if (!where) {
      throw new ProblemException(404, {
        title: 'Recipient not found',
        code: ErrorCode.RECIPIENT_NOT_FOUND,
      });
    }
    const user = await this.prisma.user.findFirst({
      where,
      select: {
        id: true,
        email: true,
      },
    });
    if (!user) {
      throw new ProblemException(404, {
        title: 'Recipient not found',
        code: ErrorCode.RECIPIENT_NOT_FOUND,
      });
    }
    if (user.id === senderUserId) {
      throw new ProblemException(400, {
        title: 'Cannot transfer to the same user',
        code: ErrorCode.SAME_WALLET_TRANSFER,
      });
    }
    return user;
  }

  private ensureWalletStatuses(sender: Wallet, recipient: Wallet) {
    if (sender.status !== 'ACTIVE') {
      throw new ProblemException(403, {
        title: 'Wallet is blocked',
        code: ErrorCode.WALLET_BLOCKED,
      });
    }
    if (recipient.status === 'CLOSED') {
      throw new ProblemException(403, {
        title: 'Recipient wallet is closed',
        code: ErrorCode.WALLET_BLOCKED,
      });
    }
  }

  private ensureCurrencyMatch(sender: Wallet, recipient: Wallet, requestCurrency: string) {
    if (
      sender.currency !== recipient.currency ||
      sender.currency.toUpperCase() !== requestCurrency.toUpperCase()
    ) {
      throw new ProblemException(400, {
        title: 'Currency mismatch',
        code: ErrorCode.VALIDATION_FAILED,
      });
    }
  }

  private ensureAmountWithinLimits(amount: number) {
    if (amount < this.transferMinAmount) {
      throw new ProblemException(400, {
        title: 'Amount below minimum',
        code: ErrorCode.LIMIT_EXCEEDED,
      });
    }
    if (amount > this.transferMaxAmount) {
      throw new ProblemException(400, {
        title: 'Amount exceeds per-transaction limit',
        code: ErrorCode.LIMIT_EXCEEDED,
      });
    }
  }

  private needsStepUp(amount: number, dailyTotal: number) {
    if (amount >= this.highValueThreshold) {
      return true;
    }
    return dailyTotal + amount >= this.transferDailyLimit * 0.8;
  }

  private async verifyStepUpToken(token: string, userId: string) {
    const payload = await this.tokens.verifyStepUpToken(token).catch(() => null);
    if (
      !payload ||
      payload.type !== 'step_up' ||
      typeof payload.sub !== 'string' ||
      payload.sub !== userId
    ) {
      throw new ProblemException(401, {
        title: 'Invalid step-up token',
        code: ErrorCode.UNAUTHORIZED,
      });
    }
    if (payload.purpose && typeof payload.purpose === 'string') {
      if (!payload.purpose.includes('transaction:transfer')) {
        throw new ProblemException(403, {
          title: 'Step-up token purpose mismatch',
          code: ErrorCode.FORBIDDEN,
        });
      }
    }
  }

  private ensureIdempotentMatch(existing: WalletTransaction, recipientWalletId: string, dto: CreateTransferDto) {
    if (
      existing.toWalletId !== recipientWalletId ||
      Number(existing.amountMinor) !== dto.amountMinor ||
      existing.currency.toUpperCase() !== dto.currency.toUpperCase()
    ) {
      throw new ProblemException(409, {
        title: 'Client reference reused with different parameters',
        code: ErrorCode.CONFLICT,
      });
    }
  }

  private buildRecipientWhere(recipient: { userId?: string; email?: string }) {
    if (recipient.userId) {
      return { id: recipient.userId };
    }
    if (recipient.email) {
      return { email: this.normalizeEmail(recipient.email) };
    }
    return null;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
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

  private toResponse(transaction: WalletTransaction, role: 'SENDER' | 'RECIPIENT'): TransferResponse {
    return {
      transactionId: transaction.id,
      type: transaction.type as WalletTransactionType,
      role,
      fromWalletId: transaction.fromWalletId ?? '',
      toWalletId: transaction.toWalletId ?? '',
      amountMinor: Number(transaction.amountMinor),
      feeMinor: Number(transaction.feeMinor ?? 0),
      currency: transaction.currency,
      note: transaction.note ?? null,
      status: transaction.status as WalletTransactionStatus,
      createdAt: transaction.createdAt,
      stepUpUsed: Boolean(transaction.stepUpUsed),
      clientReference: transaction.clientReference ?? null,
    };
  }

  private maskEmail(email?: string | null) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!domain) return email;
    const visible = local.slice(0, Math.min(local.length, 3));
    return `${visible}***@${domain}`;
  }

  private buildDisplayName(firstName?: string | null, lastName?: string | null, email?: string) {
    const first = firstName?.trim();
    const lastInitial = lastName?.trim()?.charAt(0);
    if (first) {
      return lastInitial ? `${first} ${lastInitial}.` : first;
    }
    if (email) {
      return email.split('@')[0];
    }
    return 'Recipient';
  }
}
