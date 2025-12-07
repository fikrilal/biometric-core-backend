import { ConfigService } from '@nestjs/config';
import { WalletStatus } from '@prisma/client';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';

type ConfigMock = ConfigService & { get: jest.Mock };
type PrismaMock = PrismaService & {
  wallet: { upsert: jest.Mock };
  walletTransaction: { aggregate: jest.Mock };
};

const defaultConfigValues = {
  WALLET_DEFAULT_CURRENCY: 'IDR',
  TRANSFER_MIN_AMOUNT_MINOR: 1_000,
  TRANSFER_MAX_AMOUNT_MINOR: 50_000_000,
  TRANSFER_DAILY_LIMIT_MINOR: 200_000_000,
};

function createConfigMock(overrides: Partial<Record<string, unknown>> = {}): ConfigMock {
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

function createPrismaMock(): PrismaMock {
  return {
    wallet: {
      upsert: jest.fn(),
    },
    walletTransaction: {
      aggregate: jest.fn(),
    },
  } as unknown as PrismaMock;
}

describe('WalletsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates wallets with default currency when missing', async () => {
    const prisma = createPrismaMock();
    const config = createConfigMock();
    const service = new WalletsService(prisma, config);
    const wallet = {
      id: 'wallet-1',
      userId: 'user-1',
      currency: 'IDR',
      status: WalletStatus.ACTIVE,
      availableBalanceMinor: BigInt(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.wallet.upsert.mockResolvedValue(wallet);

    const result = await service.getOrCreateWalletForUser('user-1');

    expect(result).toEqual(wallet);
    expect(prisma.wallet.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {},
      create: {
        userId: 'user-1',
        currency: 'IDR',
        status: WalletStatus.ACTIVE,
        availableBalanceMinor: BigInt(0),
      },
    });
  });

  it('returns wallet view with configured limits and daily usage', async () => {
    const prisma = createPrismaMock();
    const config = createConfigMock({
      TRANSFER_MIN_AMOUNT_MINOR: 5_000,
      TRANSFER_MAX_AMOUNT_MINOR: 2_000_000,
      TRANSFER_DAILY_LIMIT_MINOR: 5_000_000,
    });
    const service = new WalletsService(prisma, config);
    const wallet = {
      id: 'wallet-2',
      userId: 'user-2',
      currency: 'IDR',
      status: WalletStatus.ACTIVE,
      availableBalanceMinor: BigInt(150_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.wallet.upsert.mockResolvedValue(wallet);
    prisma.walletTransaction.aggregate.mockResolvedValue({
      _sum: { amountMinor: BigInt(125_000) },
    });

    const view = await service.getWalletView('user-2');

    expect(view).toEqual({
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      availableBalanceMinor: 150_000,
      status: WalletStatus.ACTIVE,
      limits: {
        minAmountMinor: 5_000,
        perTransactionMaxMinor: 2_000_000,
        dailyMaxMinor: 5_000_000,
        dailyUsedMinor: 125_000,
      },
    });
    expect(prisma.walletTransaction.aggregate).toHaveBeenCalled();
  });

  it('treats missing aggregates as zero daily usage', async () => {
    const prisma = createPrismaMock();
    const config = createConfigMock();
    const service = new WalletsService(prisma, config);
    const wallet = {
      id: 'wallet-3',
      userId: 'user-3',
      currency: 'IDR',
      status: WalletStatus.ACTIVE,
      availableBalanceMinor: BigInt(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.wallet.upsert.mockResolvedValue(wallet);
    prisma.walletTransaction.aggregate.mockResolvedValue({
      _sum: { amountMinor: null },
    });

    const view = await service.getWalletView('user-3');

    expect(view.limits.dailyUsedMinor).toBe(0);
  });
});
