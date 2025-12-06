import { TokenService } from './token.service';
import type { ConfigService } from '@nestjs/config';

describe('TokenService - step-up tokens', () => {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'AUTH_JWT_ACCESS_SECRET') {
        return 'access-secret';
      }
      if (key === 'AUTH_JWT_REFRESH_SECRET') {
        return 'refresh-secret';
      }
      throw new Error(`Missing config: ${key}`);
    }),
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'AUTH_JWT_ACCESS_TTL') {
        return '900';
      }
      if (key === 'AUTH_JWT_REFRESH_TTL') {
        return '604800';
      }
      if (key === 'STEP_UP_TOKEN_TTL_SECONDS') {
        return '30';
      }
      return defaultValue;
    }),
  } as unknown as ConfigService;

  const service = new TokenService(config);

  it('embeds purpose and challenge id in step-up token payload', async () => {
    const { token, expiresIn } = await service.signStepUpToken('user-123', 'txn:transfer', 'challenge-abc');
    expect(expiresIn).toBeGreaterThan(0);

    const payload = await service.verifyStepUpToken(token);
    expect(payload).toMatchObject({
      sub: 'user-123',
      type: 'step_up',
      purpose: 'txn:transfer',
      challengeId: 'challenge-abc',
    });
  });

  it('allows undefined purpose while still verifying claims', async () => {
    const { token } = await service.signStepUpToken('user-321', undefined, 'challenge-def');
    const payload = await service.verifyStepUpToken(token);
    expect(payload.sub).toBe('user-321');
    expect(payload.purpose).toBeUndefined();
    expect(payload.challengeId).toBe('challenge-def');
  });
});
