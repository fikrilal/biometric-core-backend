import { ConfigService } from '@nestjs/config';
import {
  Wallet,
  WalletStatus,
  WalletTransaction,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { TokenService } from '../auth-password/token.service';
import { ErrorCode } from '../common/errors/error-codes';
import { CreateTransferDto } from './dto/create-transfer.dto';

type ConfigMock = ConfigService & { get: jest.Mock };
type WalletsMock = WalletsService & { getOrCreateWalletForUser: jest.Mock };
type PrismaMock = PrismaService & {
  user: { findFirst: jest.Mock };
  walletTransaction: { aggregate: jest.Mock; findFirst: jest.Mock };
  $transaction: jest.Mock;
};
type TokenMock = TokenService & { verifyStepUpToken: jest.Mock };
type TransactionClient = {
  wallet: {
    findUniqueOrThrow: jest.Mock;
    update: jest.Mock;
  };
  walletTransaction: {
    create: jest.Mock;
  };
  walletLedgerEntry: {
    createMany: jest.Mock;
  };
};

interface ServiceContext {
  service: TransactionsService;
  prisma: PrismaMock;
  wallets: WalletsMock;
  tokens: TokenMock;
  senderWallet: Wallet;
  recipientWallet: Wallet;
  txMocks: {
    create: jest.Mock;
    update: jest.Mock;
    ledger: jest.Mock;
  };
}

const defaultConfigValues = {
  TRANSFER_MIN_AMOUNT_MINOR: 1_000,
  TRANSFER_MAX_AMOUNT_MINOR: 50_000_000,
  TRANSFER_DAILY_LIMIT_MINOR: 200_000_000,
  HIGH_VALUE_TRANSFER_THRESHOLD_MINOR: 5_000_000,
};

function createConfigMock(overrides: Partial<Record<string, number>> = {}): ConfigMock {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        return overrides[key];
      }
      if (Object.prototype.hasOwnProperty.call(defaultConfigValues, key)) {
        return defaultConfigValues[key as keyof typeof defaultConfigValues];
      }
      return defaultValue;
    }),
  } as ConfigMock;
}

function buildWallet(overrides: Partial<Wallet>): Wallet {
  const now = new Date();
  return {
    id: 'wallet-id',
    userId: 'user-id',
    currency: 'IDR',
    status: WalletStatus.ACTIVE,
    availableBalanceMinor: BigInt(1_000_000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Wallet;
}

function createBaseTransaction(
  senderWallet: Wallet,
  recipientWallet: Wallet,
  overrides: Partial<WalletTransaction> = {},
): WalletTransaction {
  const now = new Date();
  return {
    id: 'txn-1',
    type: WalletTransactionType.P2P_TRANSFER,
    status: WalletTransactionStatus.COMPLETED,
    fromWalletId: senderWallet.id,
    toWalletId: recipientWallet.id,
    amountMinor: BigInt(100_000),
    feeMinor: BigInt(0),
    currency: senderWallet.currency,
    note: 'Test transfer',
    clientReference: 'client-ref',
    stepUpUsed: false,
    createdAt: now,
    completedAt: now,
    ...overrides,
  } as WalletTransaction;
}

function createServiceContext(options?: {
  senderWallet?: Wallet;
  recipientWallet?: Wallet;
  configOverrides?: Partial<Record<string, number>>;
  dailySum?: bigint;
  existingTransaction?: WalletTransaction | null;
  recipientUser?: { id: string; email: string };
  transactionAmount?: number;
  stepUpPayload?: Record<string, unknown> | null;
}): ServiceContext {
  const senderWallet = options?.senderWallet ?? buildWallet({ id: 'wallet-sender', userId: 'user-sender' });
  const recipientWallet =
    options?.recipientWallet ?? buildWallet({ id: 'wallet-recipient', userId: 'user-recipient' });
  const config = createConfigMock(options?.configOverrides);
  const wallets = {
    getOrCreateWalletForUser: jest.fn(async (userId: string) => {
      if (userId === senderWallet.userId) {
        return senderWallet;
      }
      if (userId === recipientWallet.userId) {
        return recipientWallet;
      }
      throw new Error(`Unknown user ${userId}`);
    }),
  } as WalletsMock;

  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(
        options?.recipientUser ?? { id: recipientWallet.userId, email: 'recipient@example.com' },
      ),
    },
    walletTransaction: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amountMinor: options?.dailySum ?? BigInt(0) },
      }),
      findFirst: jest.fn().mockResolvedValue(options?.existingTransaction ?? null),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaMock;

  const txCreate = jest.fn().mockImplementation(async ({ data }) => {
    const amount = typeof data.amountMinor === 'bigint' ? data.amountMinor : BigInt(data.amountMinor);
    const record = createBaseTransaction(senderWallet, recipientWallet, {
      amountMinor: amount,
      clientReference: data.clientReference,
      note: data.note,
      stepUpUsed: data.stepUpUsed,
    });
    return record;
  });
  const txUpdate = jest.fn();
  const txLedger = jest.fn();
  prisma.$transaction.mockImplementation(
    async (handler: (tx: TransactionClient) => Promise<WalletTransaction>) =>
      handler({
        wallet: {
          findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
            if (where.id === senderWallet.id) {
              return { ...senderWallet };
            }
            if (where.id === recipientWallet.id) {
              return { ...recipientWallet };
            }
            throw new Error('wallet not found');
          }),
          update: txUpdate,
        },
        walletTransaction: {
          create: txCreate,
        },
        walletLedgerEntry: {
          createMany: txLedger,
        },
      }),
  );

  const tokens = {
    verifyStepUpToken: jest.fn().mockImplementation(async () => ({
      type: 'step_up',
      sub: senderWallet.userId,
      purpose: 'transaction:transfer',
    })),
  } as TokenMock;

  if (options?.stepUpPayload !== undefined) {
    if (options.stepUpPayload === null) {
      tokens.verifyStepUpToken.mockRejectedValue(new Error('invalid'));
    } else {
      tokens.verifyStepUpToken.mockResolvedValue(options.stepUpPayload);
    }
  }

  const service = new TransactionsService(prisma, wallets, config, tokens);
  return {
    service,
    prisma,
    wallets,
    tokens,
    senderWallet,
    recipientWallet,
    txMocks: {
      create: txCreate,
      update: txUpdate,
      ledger: txLedger,
    },
  };
}

describe('TransactionsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const defaultDto: CreateTransferDto = {
    recipient: { email: 'recipient@example.com' },
    amountMinor: 100_000,
    currency: 'IDR',
    note: 'Test transfer',
    clientReference: 'client-123',
  };

  it('creates transfers and updates wallets/ledger entries', async () => {
    const ctx = createServiceContext();

    const result = await ctx.service.createTransfer('user-sender', defaultDto, {});

    expect(result.amountMinor).toBe(100_000);
    expect(ctx.wallets.getOrCreateWalletForUser).toHaveBeenCalledTimes(2);
    expect(ctx.prisma.$transaction).toHaveBeenCalled();
    expect(ctx.txMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromWalletId: ctx.senderWallet.id,
          toWalletId: ctx.recipientWallet.id,
          stepUpUsed: false,
        }),
      }),
    );
    expect(ctx.txMocks.ledger).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ walletId: ctx.senderWallet.id, direction: 'DEBIT' }),
        expect.objectContaining({ walletId: ctx.recipientWallet.id, direction: 'CREDIT' }),
      ],
    });
    expect(ctx.txMocks.update).toHaveBeenCalledTimes(2);
  });

  it('rejects transfers to the same user', async () => {
    const sender = buildWallet({ id: 'w', userId: 'same-user' });
    const ctx = createServiceContext({
      senderWallet: sender,
      recipientWallet: buildWallet({ id: 'w2', userId: 'other' }),
      recipientUser: { id: 'same-user', email: 'self@example.com' },
    });

    await expect(ctx.service.createTransfer('same-user', defaultDto, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.SAME_WALLET_TRANSFER }),
      status: 400,
    });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when sender balance is insufficient', async () => {
    const ctx = createServiceContext({
      senderWallet: buildWallet({ userId: 'user-sender', availableBalanceMinor: BigInt(50_000) }),
    });

    await expect(ctx.service.createTransfer('user-sender', defaultDto, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.INSUFFICIENT_FUNDS }),
      status: 400,
    });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when amount exceeds per-transaction limit', async () => {
    const ctx = createServiceContext({
      configOverrides: { TRANSFER_MAX_AMOUNT_MINOR: 10_000 },
    });
    const dto: CreateTransferDto = { ...defaultDto, amountMinor: 25_000 };

    await expect(ctx.service.createTransfer('user-sender', dto, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.LIMIT_EXCEEDED }),
      status: 400,
    });
  });

  it('rejects when daily limit would be exceeded', async () => {
    const ctx = createServiceContext({
      configOverrides: { TRANSFER_DAILY_LIMIT_MINOR: 150_000 },
      dailySum: BigInt(120_000),
    });

    await expect(ctx.service.createTransfer('user-sender', defaultDto, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.LIMIT_EXCEEDED }),
      status: 400,
    });
  });

  it('returns existing transaction when clientReference matches', async () => {
    const ctx = createServiceContext({
      existingTransaction: createBaseTransaction(
        buildWallet({ id: 'wallet-sender', userId: 'user-sender' }),
        buildWallet({ id: 'wallet-recipient', userId: 'user-recipient' }),
      ),
    });

    const result = await ctx.service.createTransfer('user-sender', defaultDto, {});

    expect(result.transactionId).toBe('txn-1');
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails idempotency when parameters differ', async () => {
    const existing = createBaseTransaction(
      buildWallet({ id: 'wallet-sender', userId: 'user-sender' }),
      buildWallet({ id: 'wallet-recipient', userId: 'user-recipient' }),
      { amountMinor: BigInt(50_000) },
    );
    const ctx = createServiceContext({ existingTransaction: existing });

    await expect(ctx.service.createTransfer('user-sender', defaultDto, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.CONFLICT }),
      status: 409,
    });
  });

  it('requires step-up token for high value transfers and marks stepUpUsed', async () => {
    const ctx = createServiceContext({
      senderWallet: buildWallet({
        id: 'wallet-sender',
        userId: 'user-sender',
        availableBalanceMinor: BigInt(10_000_000),
      }),
    });
    const dto: CreateTransferDto = { ...defaultDto, amountMinor: 6_000_000 };
    const result = await ctx.service.createTransfer('user-sender', dto, { headerToken: 'token-1' });

    expect(ctx.tokens.verifyStepUpToken).toHaveBeenCalledWith('token-1');
    expect(ctx.txMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stepUpUsed: true }),
      }),
    );
    expect(result.stepUpUsed).toBe(true);
  });

  it('requires step-up when daily usage nears the configured limit', async () => {
    const ctx = createServiceContext({
      senderWallet: buildWallet({
        id: 'wallet-sender',
        userId: 'user-sender',
        availableBalanceMinor: BigInt(500_000),
      }),
      configOverrides: { TRANSFER_DAILY_LIMIT_MINOR: 200_000 },
      dailySum: BigInt(150_000),
    });
    const dto: CreateTransferDto = { ...defaultDto, amountMinor: 30_000 };

    await expect(ctx.service.createTransfer('user-sender', dto, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      status: 401,
    });
  });

  it('rejects when step-up purpose is invalid', async () => {
    const ctx = createServiceContext({
      senderWallet: buildWallet({
        id: 'wallet-sender',
        userId: 'user-sender',
        availableBalanceMinor: BigInt(10_000_000),
      }),
      stepUpPayload: { type: 'step_up', sub: 'user-sender', purpose: 'other' },
    });
    const dto: CreateTransferDto = { ...defaultDto, amountMinor: 6_000_000 };

    await expect(ctx.service.createTransfer('user-sender', dto, { headerToken: 'token-1' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.FORBIDDEN }),
      status: 403,
    });
  });

  it('rejects when step-up token subject does not match user', async () => {
    const ctx = createServiceContext({
      senderWallet: buildWallet({
        id: 'wallet-sender',
        userId: 'user-sender',
        availableBalanceMinor: BigInt(10_000_000),
      }),
      stepUpPayload: { type: 'step_up', sub: 'another-user', purpose: 'transaction:transfer' },
    });
    const dto: CreateTransferDto = { ...defaultDto, amountMinor: 6_000_000 };

    await expect(ctx.service.createTransfer('user-sender', dto, { headerToken: 'token-2' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      status: 401,
    });
  });
});
