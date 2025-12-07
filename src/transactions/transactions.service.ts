import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { StepUpRequiredReason, TransactionsMetricsService } from './transactions.metrics';

interface StepUpPayload {
  token?: string;
  headerToken?: string;
}

interface TransferRequestContext {
  ip?: string;
}

interface TransferLogContext {
  userId: string;
  fromWalletId: string;
  toWalletId?: string;
  recipientUserId?: string;
  clientReference?: string;
  amountMinor?: number;
  currency?: string;
  ip?: string;
}

interface StepUpDecision {
  required: boolean;
  reason?: StepUpRequiredReason;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly transferMinAmount: number;
  private readonly transferMaxAmount: number;
  private readonly transferAbsoluteMax: number;
  private readonly transferEffectiveMax: number;
  private readonly transferDailyLimit: number;
  private readonly highValueThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly metrics: TransactionsMetricsService,
  ) {
    this.transferMinAmount = this.config.get<number>('TRANSFER_MIN_AMOUNT_MINOR', 1000);
    this.transferMaxAmount = this.config.get<number>('TRANSFER_MAX_AMOUNT_MINOR', 50_000_000);
    this.transferAbsoluteMax = this.config.get<number>('TRANSFER_ABSOLUTE_MAX_MINOR', 100_000_000);
    this.transferEffectiveMax = Math.min(this.transferMaxAmount, this.transferAbsoluteMax);
    this.transferDailyLimit = this.config.get<number>('TRANSFER_DAILY_LIMIT_MINOR', 200_000_000);
    this.highValueThreshold = this.config.get<number>(
      'HIGH_VALUE_TRANSFER_THRESHOLD_MINOR',
      5_000_000,
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
      },
    });
    if (!user) {
      throw ProblemException.notFound('Recipient not found');
    }
    const wallet = await this.wallets.getOrCreateWalletForUser(user.id);
    return {
      userId: user.id,
      displayName: this.buildDisplayName(user.firstName, user.lastName, user.email),
      maskedIdentifier: this.maskEmail(user.email),
      canReceiveTransfers: wallet.status !== 'CLOSED',
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
    requestContext?: TransferRequestContext,
  ): Promise<TransferResponse> {
    const senderWallet = await this.wallets.getOrCreateWalletForUser(userId);
    const logContext: TransferLogContext = {
      userId,
      fromWalletId: senderWallet.id,
      clientReference: dto.clientReference ?? undefined,
      ip: requestContext?.ip,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
    };

    try {
      const recipientUser = await this.resolveRecipientUser(dto.recipient, userId);
      logContext.recipientUserId = recipientUser.id;
      const recipientWallet = await this.wallets.getOrCreateWalletForUser(recipientUser.id);
      logContext.toWalletId = recipientWallet.id;

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

      const stepUpDecision = this.needsStepUp(dto.amountMinor, dailyTotal);
      if (stepUpDecision.required) {
        this.metrics.recordStepUpRequired(stepUpDecision.reason ?? 'high_value');
        const token = stepUp.headerToken?.trim() || dto.stepUpToken?.trim();
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
          this.metrics.recordTransferReplayed();
          this.logTransferReplay(logContext, existing);
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
            stepUpUsed: stepUpDecision.required,
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

      const response = this.toResponse(transaction, 'SENDER');
      this.metrics.recordTransferCreated({
        amountMinor: response.amountMinor,
        currency: response.currency,
        stepUpUsed: response.stepUpUsed,
      });
      this.logTransferSuccess(logContext, response);
      return response;
    } catch (error) {
      this.metrics.recordTransferFailed(this.extractErrorCode(error));
      this.logTransferFailure(logContext, error);
      throw error;
    }
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
    if (amount > this.transferEffectiveMax) {
      throw new ProblemException(400, {
        title: 'Amount exceeds per-transaction limit',
        code: ErrorCode.LIMIT_EXCEEDED,
      });
    }
  }

  private needsStepUp(amount: number, dailyTotal: number): StepUpDecision {
    if (amount >= this.highValueThreshold) {
      return { required: true, reason: 'high_value' };
    }
    if (dailyTotal + amount >= this.transferDailyLimit * 0.8) {
      return { required: true, reason: 'daily_usage' };
    }
    return { required: false };
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
    throw new ProblemException(400, {
      title: 'Recipient identifier required',
      code: ErrorCode.VALIDATION_FAILED,
    });
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

  private logTransferSuccess(context: TransferLogContext, response: TransferResponse) {
    this.logger.log({
      event: 'transfer.created',
      userId: context.userId,
      fromWalletId: context.fromWalletId,
      toWalletId: response.toWalletId,
      transactionId: response.transactionId,
      amountMinor: response.amountMinor,
      currency: response.currency,
      stepUpUsed: response.stepUpUsed,
      clientReference: context.clientReference,
      ip: context.ip,
    });
  }

  private logTransferReplay(context: TransferLogContext, transaction: WalletTransaction) {
    this.logger.log({
      event: 'transfer.replayed',
      userId: context.userId,
      fromWalletId: context.fromWalletId,
      toWalletId: transaction.toWalletId,
      transactionId: transaction.id,
      clientReference: context.clientReference,
    });
  }

  private logTransferFailure(context: TransferLogContext, error: unknown) {
    this.logger.warn({
      event: 'transfer.failed',
      userId: context.userId,
      fromWalletId: context.fromWalletId,
      toWalletId: context.toWalletId,
      recipientUserId: context.recipientUserId,
      clientReference: context.clientReference,
      amountMinor: context.amountMinor,
      currency: context.currency,
      ip: context.ip,
      reason: this.extractErrorCode(error) ?? 'unknown',
    });
  }

  private extractErrorCode(error: unknown): string | undefined {
    if (error instanceof ProblemException) {
      const response = error.getResponse() as { code?: string } | string;
      if (typeof response === 'object' && response !== null && 'code' in response) {
        const code = (response as { code?: string }).code;
        return typeof code === 'string' ? code : undefined;
      }
    }
    return undefined;
  }
}
