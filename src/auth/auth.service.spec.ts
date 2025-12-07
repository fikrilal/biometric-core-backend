import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WebAuthnService } from '../webauthn/webauthn.service';
import { RateLimiterService } from '../common/rate-limiter/rate-limiter.service';
import { AuthTokensService } from '../auth-password/auth-tokens.service';
import { TokenService } from '../auth-password/token.service';
import { WebauthnSignCountMode } from '../config/env.validation';
import { ErrorCode } from '../common/errors/error-codes';
interface TestCredential {
  credentialId: string;
  userId: string;
  publicKey: Buffer;
  signCount: number;
  revoked: boolean;
  transports: string | null;
  devices: { id: string; active: boolean }[];
}

describe('AuthService signCount enforcement', () => {
  const prisma = {
    credential: {
      update: jest.fn(),
    },
    device: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService & {
    credential: { update: jest.Mock };
    device: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  const redis = {} as RedisService;
  const webauthn = {
    getSignCountMode: jest.fn(),
  } as unknown as WebAuthnService & { getSignCountMode: jest.Mock };
  const rateLimiter = {} as RateLimiterService;
  const authTokens = {} as AuthTokensService;
  const tokens = {} as TokenService;

  const createService = () =>
    new AuthService(prisma, redis, webauthn, rateLimiter, authTokens, tokens);

  afterEach(() => {
    jest.resetAllMocks();
  });

  const buildCredential = (overrides: Partial<TestCredential> = {}): TestCredential => ({
    credentialId: 'cred-1',
    userId: 'user-1',
    publicKey: Buffer.from([1, 2, 3]),
    signCount: 5,
    revoked: false,
    transports: null,
    devices: [{ id: 'device-1', active: true }],
    ...overrides,
  });

  it('updates stored signCount when counter advances', async () => {
    webauthn.getSignCountMode.mockReturnValue(WebauthnSignCountMode.Strict);
    const service = createService();
    const credential = buildCredential({ signCount: 5 });

    await service['enforceSignCount']('user-1', credential, 7, 'login');

    expect(prisma.credential.update).toHaveBeenCalledWith({
      where: { credentialId: 'cred-1' },
      data: { signCount: 7 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores equal signCount and zero-only authenticators', async () => {
    webauthn.getSignCountMode.mockReturnValue(WebauthnSignCountMode.Strict);
    const service = createService();

    await service['enforceSignCount']('user-1', buildCredential({ signCount: 10 }), 10, 'login');
    await service['enforceSignCount']('user-1', buildCredential({ signCount: 0 }), 0, 'login');

    expect(prisma.credential.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revokes credential and devices when regression occurs in strict mode', async () => {
    webauthn.getSignCountMode.mockReturnValue(WebauthnSignCountMode.Strict);
    const service = createService();
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    const credential = buildCredential({ signCount: 10 });

    await expect(
      service['enforceSignCount']('user-1', credential, 5, 'login'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: ErrorCode.CREDENTIAL_COMPROMISED }),
      status: 401,
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.credential.update).toHaveBeenCalledWith({
      where: { credentialId: 'cred-1' },
      data: expect.objectContaining({ revoked: true }),
    });
    expect(prisma.device.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['device-1'] } },
      data: expect.objectContaining({ deactivatedReason: 'sign_count_regression' }),
    });
  });

  it('logs regression but does not revoke in lenient mode', async () => {
    webauthn.getSignCountMode.mockReturnValue(WebauthnSignCountMode.Lenient);
    const service = createService();
    const credential = buildCredential({ signCount: 10 });

    await service['enforceSignCount']('user-1', credential, 5, 'step_up');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.credential.update).not.toHaveBeenCalled();
  });
});
