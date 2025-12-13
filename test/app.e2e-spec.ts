import { Test } from '@nestjs/testing';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { Logger } from 'nestjs-pino';
import { MockEmailService } from '../src/auth-password/email.service';
import { ErrorCode } from '../src/common/errors/error-codes';
import { WebAuthnService, type WebAuthnExistingCredential, type WebAuthnUserDescriptor } from '../src/webauthn/webauthn.service';
import { WebauthnSignCountMode } from '../src/config/env.validation';
import { TokenService } from '../src/auth-password/token.service';
import { PrismaClient } from '@prisma/client';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server/esm/types';

const prisma = new PrismaClient();

async function registerAndVerifyUser(
  server: Parameters<typeof request>[0],
  {
    email,
    password,
    firstName,
    lastName,
  }: { email: string; password: string; firstName: string; lastName: string },
) {
  await request(server)
    .post('/v1/auth/password/register')
    .send({ email, password, firstName, lastName })
    .expect(201);

  const verifyToken = MockEmailService.pullLatestVerificationToken(email);
  expect(verifyToken).toBeDefined();
  await request(server)
    .post('/v1/auth/password/verify/confirm')
    .send({ token: verifyToken })
    .expect(200);
}

async function loginUser(server: Parameters<typeof request>[0], email: string, password: string) {
  const login = await request(server)
    .post('/v1/auth/password/login')
    .send({ email, password })
    .expect(200);
  return login.body.data.accessToken as string;
}

function buildFakeRegistration(credentialId: string): RegistrationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: 'test-client-data',
      attestationObject: 'test-attestation',
      authenticatorData: undefined,
      publicKeyAlgorithm: undefined,
      publicKey: undefined,
      transports: undefined,
    },
    clientExtensionResults: {},
  };
}

function buildFakeAssertion(credentialId: string): AuthenticationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: 'test-client-data',
      authenticatorData: 'test-auth-data',
      signature: 'test-signature',
      userHandle: undefined,
    },
    clientExtensionResults: {},
  };
}

async function enrollDevice(
  server: Parameters<typeof request>[0],
  accessToken: string,
  credentialId: string,
) {
  const enrollChallenge = await request(server)
    .post('/v1/enroll/challenge')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ deviceName: 'Test Device' })
    .expect(200);

  const challengeId = enrollChallenge.body.data.challengeId as string;
  const fakeRegistration = buildFakeRegistration(credentialId);
  await request(server)
    .post('/v1/enroll/verify')
    .send({
      challengeId,
      credential: fakeRegistration,
    })
    .expect(200);
}

async function obtainStepUpToken(
  server: Parameters<typeof request>[0],
  accessToken: string,
  credentialId: string,
) {
  const stepUpChallenge = await request(server)
    .post('/v1/auth/step-up/challenge')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ purpose: 'transaction:transfer' })
    .expect(200);

  const challengeId = stepUpChallenge.body.data.challengeId as string;
  const fakeAssertion = buildFakeAssertion(credentialId);
  const verify = await request(server)
    .post('/v1/auth/step-up/verify')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      challengeId,
      credential: fakeAssertion,
    })
    .expect(200);

  return verify.body.data.stepUpToken as string;
}

class FakeWebAuthnService {
  private readonly registrationChallenge = 'test-registration-challenge';
  private readonly authenticationChallenge = 'test-auth-challenge';

  getChallengeTtlMs(): number {
    return 180000;
  }

  getSignCountMode(): WebauthnSignCountMode {
    return WebauthnSignCountMode.Strict;
  }

  async generateRegistrationOptionsForUser(
    user: WebAuthnUserDescriptor,
    _existingCredentials: WebAuthnExistingCredential[],
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return {
      rp: { id: 'localhost', name: 'Fake RP' },
      user: { id: user.id, name: user.email, displayName: user.email },
      challenge: this.registrationChallenge,
      pubKeyCredParams: [],
    };
  }

  async verifyRegistration(
    response: RegistrationResponseJSON,
    _expectedChallenge: string,
  ) {
    // In tests we trust the wiring and ignore the actual challenge value.
    // Always treat the response as a valid registration.
    return {
      credentialID: response.id,
      credentialPublicKey: new Uint8Array([1, 2, 3]),
      signCount: 0,
      aaguid: 'test-aaguid',
    };
  }

  async generateAuthenticationOptionsForUser(
    _credentials: WebAuthnExistingCredential[],
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return {
      challenge: this.authenticationChallenge,
    };
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    _credential: WebAuthnCredential,
  ) {
    if (expectedChallenge !== this.authenticationChallenge) {
      return null;
    }
    return {
      credentialID: response.id,
      newSignCount: 1,
    };
  }
}

describe('App e2e (health)', () => {
  console.log('TEST DATABASE_URL', process.env.DATABASE_URL);
  let app: INestApplication;
  let tokenService: TokenService;
  const getServer = () => {
    const instance = (app as NestFastifyApplication).getHttpAdapter().getInstance();
    return ((req, res) => {
      instance.server.emit('request', req, res);
    }) as Parameters<typeof request>[0];
  };

  beforeAll(async () => {
    // Minimal env for ConfigModule validation during tests
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:asalbaca@localhost:5433/biometric_core?schema=public';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WebAuthnService)
      .useClass(FakeWebAuthnService)
      .compile();

    app = await moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      bufferLogs: true,
    });
    app.setGlobalPrefix('v1', {
      exclude: [{ path: 'health', method: RequestMethod.GET }],
    });
    app.useLogger(app.get(Logger));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    MockEmailService.resetAllMocks();
  });

  it('/health (GET)', async () => {
    const server = getServer();
    await request(server).get('/health').expect(200).expect(({ body }) => {
      expect(body.status).toBe('ok');
    });
  });

  it('/v1/auth/ping (GET) returns envelope and echoes X-Request-Id', async () => {
    const server = getServer();
    const reqId = 'e2e-test-req-1';
    const res = await request(server)
      .get('/v1/auth/ping')
      .set('X-Request-Id', reqId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(reqId);
    expect(res.body).toEqual({ data: { ok: true } });
  });

  it('unknown route returns ProblemDetails with traceId', async () => {
    const server = getServer();
    const res = await request(server).get('/v1/does-not-exist').expect(404);
    const body = res.body;
    // Content type may be set; ensure we have a reasonable shape
    expect(typeof body.title).toBe('string');
    expect(body.status).toBe(404);
    expect(typeof body.traceId === 'string' || body.traceId === undefined).toBeTruthy();
  });

  it('users module supports create/list/get', async () => {
    const server = getServer();
    const email = `user-${Date.now()}@example.com`;
    const firstName = 'Test';
    const lastName = 'User';

    const createRes = await request(server)
      .post('/v1/users')
      .set('Idempotency-Key', `idem-${Date.now()}`)
      .send({ email, firstName, lastName })
      .expect(201);

    expect(createRes.headers['location']).toMatch(/\/v1\/users\//);
    expect(createRes.body.data.email).toBe(email);
    expect(createRes.body.data.firstName).toBe(firstName);
    expect(createRes.body.data.lastName).toBe(lastName);
    const userId = createRes.body.data.id;

    const listRes = await request(server)
      .get('/v1/users?limit=1')
      .expect(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.meta).toHaveProperty('limit');

    const getRes = await request(server).get(`/v1/users/${userId}`).expect(200);
    expect(getRes.body.data.id).toBe(userId);
    expect(getRes.body.data.email).toBe(email);
    expect(getRes.body.data.firstName).toBe(firstName);
    expect(getRes.body.data.lastName).toBe(lastName);
  });

  it('password auth flow (register/login/refresh/logout)', async () => {
    const server = getServer();
    const email = `auth-${Date.now()}@example.com`;
    const password = 'Password123!';

    const register = await request(server)
      .post('/v1/auth/password/register')
      .send({ email, password, firstName: 'Auth', lastName: 'User' })
      .expect(201);
    expect(register.body.data.accessToken).toBeDefined();
    expect(register.body.data.refreshToken).toBeDefined();

    // Verify email before login (required by the system)
    const verifyToken = MockEmailService.pullLatestVerificationToken(email);
    expect(verifyToken).toBeDefined();
    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: verifyToken })
      .expect(200);

    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(200);
    expect(login.body.data.accessToken).toBeDefined();

    const refresh = await request(server)
      .post('/v1/auth/password/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);
    expect(refresh.body.data.accessToken).toBeDefined();

    await request(server)
      .post('/v1/auth/password/logout')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);
  });

  it('requires email verification before login/refresh', async () => {
    const server = getServer();
    const email = `verify-${Date.now()}@example.com`;
    const password = 'Password123!';

    const register = await request(server)
      .post('/v1/auth/password/register')
      .send({ email, password, firstName: 'Verify', lastName: 'User' })
      .expect(201);

    expect(register.body.data.emailVerified).toBe(false);

    await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(403);

    await request(server)
      .post('/v1/auth/password/refresh')
      .send({ refreshToken: register.body.data.refreshToken })
      .expect(403);

    const verifyToken = MockEmailService.pullLatestVerificationToken(email);
    expect(verifyToken).toBeDefined();

    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: verifyToken })
      .expect(200);

    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(200);

    expect(login.body.data.emailVerified).toBe(true);
  });

  it('supports password reset flow', async () => {
    const server = getServer();
    const email = `reset-${Date.now()}@example.com`;
    const password = 'Password123!';

    await request(server)
      .post('/v1/auth/password/register')
      .send({ email, password, firstName: 'Reset', lastName: 'User' })
      .expect(201);

    const verifyToken = MockEmailService.pullLatestVerificationToken(email);
    expect(verifyToken).toBeDefined();

    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: verifyToken })
      .expect(200);

    await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(200);

    await request(server)
      .post('/v1/auth/password/reset/request')
      .send({ email })
      .expect(200);

    const resetToken = MockEmailService.pullLatestResetToken(email);
    expect(resetToken).toBeDefined();

    const newPassword = 'Password456!';
    await request(server)
      .post('/v1/auth/password/reset/confirm')
      .send({ token: resetToken, newPassword })
      .expect(200);

    await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(401);

    const loginNew = await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password: newPassword })
      .expect(200);

    expect(loginNew.body.data.emailVerified).toBe(true);
  });

  it('supports enrollment and biometric login flow (happy path with fake WebAuthn)', async () => {
    const server = getServer();
    const email = `bio-${Date.now()}@example.com`;
    const password = 'Password123!';

    // Register user
    await request(server)
      .post('/v1/auth/password/register')
      .send({ email, password, firstName: 'Bio', lastName: 'User' })
      .expect(201);

    // Verify email
    const verifyToken = MockEmailService.pullLatestVerificationToken(email);
    expect(verifyToken).toBeDefined();
    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: verifyToken })
      .expect(200);

    // Login with password to get access token
    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(200);

    const accessToken: string = login.body.data.accessToken;
    expect(accessToken).toBeDefined();

    // Create enrollment challenge (requires JWT)
    const enrollChallenge = await request(server)
      .post('/v1/enroll/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ deviceName: 'Test Device' })
      .expect(200);

    const enrollChallengeId = enrollChallenge.body.data.challengeId as string;
    expect(enrollChallengeId).toBeDefined();

    // Verify enrollment with fake WebAuthn response
    const credentialId = `test-credential-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fakeRegistration: RegistrationResponseJSON = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: 'test-client-data',
        attestationObject: 'test-attestation',
        authenticatorData: undefined,
        publicKeyAlgorithm: undefined,
        publicKey: undefined,
        transports: undefined,
      },
      clientExtensionResults: {},
    };

    const enrollVerify = await request(server)
      .post('/v1/enroll/verify')
      .send({
        challengeId: enrollChallengeId,
        credential: fakeRegistration,
      })
      .expect(200);

    expect(enrollVerify.body.data.credentialId).toBeDefined();
    expect(enrollVerify.body.data.deviceId).toBeDefined();

    // Create biometric auth challenge
    const authChallenge = await request(server)
      .post('/v1/auth/challenge')
      .send({ email })
      .expect(200);

    const authChallengeId = authChallenge.body.data.challengeId as string;
    expect(authChallengeId).toBeDefined();

    // Verify biometric auth with fake assertion
    const fakeAssertion: AuthenticationResponseJSON = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: 'test-client-data',
        authenticatorData: 'test-auth-data',
        signature: 'test-signature',
        userHandle: undefined,
      },
      clientExtensionResults: {},
    };

    const authVerify = await request(server)
      .post('/v1/auth/verify')
      .send({
        challengeId: authChallengeId,
        credential: fakeAssertion,
      })
      .expect(200);

    expect(authVerify.body.data.accessToken).toBeDefined();
    expect(authVerify.body.data.refreshToken).toBeDefined();
    expect(authVerify.body.data.emailVerified).toBe(true);
  });

  it('supports step-up biometric flow with fake WebAuthn', async () => {
    const server = getServer();
    const email = `stepup-${Date.now()}@example.com`;
    const password = 'Password123!';

    // Register user
    const register = await request(server)
      .post('/v1/auth/password/register')
      .send({ email, password, firstName: 'Step', lastName: 'Up' })
      .expect(201);

    expect(register.body.data.accessToken).toBeDefined();

    // Verify email
    const verifyToken = MockEmailService.pullLatestVerificationToken(email);
    expect(verifyToken).toBeDefined();
    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: verifyToken })
      .expect(200);

    // Login with password to get access token
    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(200);

    const accessToken: string = login.body.data.accessToken;
    expect(accessToken).toBeDefined();

    // Enroll a device for the user
    const enrollChallenge = await request(server)
      .post('/v1/enroll/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ deviceName: 'Step-Up Device' })
      .expect(200);

    const enrollChallengeId = enrollChallenge.body.data.challengeId as string;
    expect(enrollChallengeId).toBeDefined();

    const credentialId = `stepup-credential-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fakeRegistration: RegistrationResponseJSON = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: 'test-client-data',
        attestationObject: 'test-attestation',
        authenticatorData: undefined,
        publicKeyAlgorithm: undefined,
        publicKey: undefined,
        transports: undefined,
      },
      clientExtensionResults: {},
    };

    const enrollVerify = await request(server)
      .post('/v1/enroll/verify')
      .send({
        challengeId: enrollChallengeId,
        credential: fakeRegistration,
      })
      .expect(200);

    expect(enrollVerify.body.data.deviceId).toBeDefined();
    expect(enrollVerify.body.data.credentialId).toBeDefined();

    // Create step-up challenge (requires JWT)
    const purpose = 'test_step_up';
    const stepUpChallenge = await request(server)
      .post('/v1/auth/step-up/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ purpose })
      .expect(200);

    const stepUpChallengeId = stepUpChallenge.body.data.challengeId as string;
    expect(stepUpChallengeId).toBeDefined();

    // Verify step-up with fake WebAuthn assertion
    const fakeAssertion: AuthenticationResponseJSON = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: 'test-client-data',
        authenticatorData: 'test-auth-data',
        signature: 'test-signature',
        userHandle: undefined,
      },
      clientExtensionResults: {},
    };

    const stepUpVerify = await request(server)
      .post('/v1/auth/step-up/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        challengeId: stepUpChallengeId,
        credential: fakeAssertion,
      })
      .expect(200);

    const stepUpToken = stepUpVerify.body.data.stepUpToken as string;
    expect(typeof stepUpToken).toBe('string');
    expect(stepUpToken.length).toBeGreaterThan(0);
    const decoded = await tokenService.verifyStepUpToken(stepUpToken);
    expect(decoded.purpose).toBe(purpose);
  });

  it('exposes wallet balance and history endpoints for authenticated users', async () => {
    const server = getServer();
    const email = `wallet-${Date.now()}@example.com`;
    const password = 'Password123!';

    await request(server)
      .post('/v1/auth/password/register')
      .send({ email, password, firstName: 'Wallet', lastName: 'User' })
      .expect(201);

    const verifyToken = MockEmailService.pullLatestVerificationToken(email);
    expect(verifyToken).toBeDefined();
    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: verifyToken })
      .expect(200);

    const login = await request(server)
      .post('/v1/auth/password/login')
      .send({ email, password })
      .expect(200);
    const accessToken = login.body.data.accessToken as string;
    expect(typeof accessToken).toBe('string');

    const walletRes = await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(walletRes.body.data.currency).toBeDefined();
    expect(walletRes.body.data.limits).toBeDefined();

    const historyRes = await request(server)
      .get('/v1/wallets/me/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(historyRes.body.data)).toBe(true);
  });

  it('supports transfers between wallets', async () => {
    const server = getServer();
    const senderEmail = `sender-${Date.now()}@example.com`;
    const recipientEmail = `recipient-${Date.now()}@example.com`;
    const password = 'Password123!';

    await request(server)
      .post('/v1/auth/password/register')
      .send({ email: senderEmail, password, firstName: 'Sender', lastName: 'User' })
      .expect(201);
    await request(server)
      .post('/v1/auth/password/register')
      .send({ email: recipientEmail, password, firstName: 'Recipient', lastName: 'User' })
      .expect(201);

    const senderVerify = MockEmailService.pullLatestVerificationToken(senderEmail);
    const recipientVerify = MockEmailService.pullLatestVerificationToken(recipientEmail);
    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: senderVerify })
      .expect(200);
    await request(server)
      .post('/v1/auth/password/verify/confirm')
      .send({ token: recipientVerify })
      .expect(200);

    const senderLogin = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: senderEmail, password })
      .expect(200);
    const recipientLogin = await request(server)
      .post('/v1/auth/password/login')
      .send({ email: recipientEmail, password })
      .expect(200);

    const senderToken = senderLogin.body.data.accessToken as string;
    const recipientToken = recipientLogin.body.data.accessToken as string;

    await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${senderToken}`)
      .expect(200);
    await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${recipientToken}`)
      .expect(200);

    const senderWallet = await prisma.wallet.findFirstOrThrow({
      where: { user: { email: senderEmail.toLowerCase() } },
    });
    await prisma.wallet.update({
      where: { id: senderWallet.id },
      data: { availableBalanceMinor: 1_000_000 },
    });

    const clientReference = `client-${Date.now()}`;
    const transfer = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `transfer-${Date.now()}`)
      .send({
        recipient: { email: recipientEmail },
        amountMinor: 100_000,
        currency: 'IDR',
        note: 'Test transfer',
        clientReference,
      })
      .expect(201);

    expect(transfer.body.data.amountMinor).toBe(100_000);
    expect(transfer.body.data.clientReference).toBe(clientReference);

    const senderWalletAfter = await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${senderToken}`)
      .expect(200);
    expect(senderWalletAfter.body.data.availableBalanceMinor).toBe(900_000);

    const recipientWalletAfter = await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${recipientToken}`)
      .expect(200);
    expect(recipientWalletAfter.body.data.availableBalanceMinor).toBe(100_000);
  });

  it('requires step-up token for high value transfers', async () => {
    const server = getServer();
    const password = 'Password123!';
    const senderEmail = `hv-sender-${Date.now()}@example.com`;
    const recipientEmail = `hv-recipient-${Date.now()}@example.com`;

    await registerAndVerifyUser(server, {
      email: senderEmail,
      password,
      firstName: 'HV Sender',
      lastName: 'User',
    });
    await registerAndVerifyUser(server, {
      email: recipientEmail,
      password,
      firstName: 'HV Recipient',
      lastName: 'User',
    });

    const senderToken = await loginUser(server, senderEmail, password);
    await loginUser(server, recipientEmail, password);

    await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${senderToken}`)
      .expect(200);

    const senderWallet = await prisma.wallet.findFirstOrThrow({
      where: { user: { email: senderEmail.toLowerCase() } },
    });
    await prisma.wallet.update({
      where: { id: senderWallet.id },
      data: { availableBalanceMinor: 10_000_000 },
    });

    const basePayload = {
      recipient: { email: recipientEmail },
      amountMinor: 6_000_000,
      currency: 'IDR',
      clientReference: `hv-${Date.now()}`,
      note: 'High value transfer',
    };

    const missingStepUp = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `hv-${Date.now()}`)
      .send(basePayload)
      .expect(401);
    expect(missingStepUp.body.code).toBe(ErrorCode.UNAUTHORIZED);

    const credentialId = `hv-cred-${Date.now()}`;
    await enrollDevice(server, senderToken, credentialId);
    const stepUpToken = await obtainStepUpToken(server, senderToken, credentialId);

    const transfer = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `hv-${Date.now() + 1}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send(basePayload)
      .expect(201);

    expect(transfer.body.data.stepUpUsed).toBe(true);
    expect(transfer.body.data.amountMinor).toBe(6_000_000);
  });

  it('rejects transfers that violate funds, limits, or missing recipients', async () => {
    const server = getServer();
    const password = 'Password123!';
    const senderEmail = `err-sender-${Date.now()}@example.com`;
    const recipientEmail = `err-recipient-${Date.now()}@example.com`;

    await registerAndVerifyUser(server, {
      email: senderEmail,
      password,
      firstName: 'Error',
      lastName: 'Sender',
    });
    await registerAndVerifyUser(server, {
      email: recipientEmail,
      password,
      firstName: 'Error',
      lastName: 'Recipient',
    });

    const senderToken = await loginUser(server, senderEmail, password);
    await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${senderToken}`)
      .expect(200);

    const senderWallet = await prisma.wallet.findFirstOrThrow({
      where: { user: { email: senderEmail.toLowerCase() } },
    });
    await prisma.wallet.update({
      where: { id: senderWallet.id },
      data: { availableBalanceMinor: 50_000 },
    });

    const insufficient = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `err-${Date.now()}`)
      .send({
        recipient: { email: recipientEmail },
        amountMinor: 100_000,
        currency: 'IDR',
        clientReference: `err-${Date.now()}`,
      })
      .expect(400);
    expect(insufficient.body.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);

    await prisma.wallet.update({
      where: { id: senderWallet.id },
      data: { availableBalanceMinor: 500_000_000 },
    });

    const limit = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `err-${Date.now() + 1}`)
      .send({
        recipient: { email: recipientEmail },
        amountMinor: 100_000_000,
        currency: 'IDR',
        clientReference: `err-limit-${Date.now()}`,
      })
      .expect(400);
    expect(limit.body.code).toBe(ErrorCode.LIMIT_EXCEEDED);

    const missingRecipient = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `err-${Date.now() + 2}`)
      .send({
        recipient: { email: 'missing-user@example.com' },
        amountMinor: 10_000,
        currency: 'IDR',
        clientReference: `err-missing-${Date.now()}`,
      })
      .expect(404);
    expect(missingRecipient.body.code).toBe(ErrorCode.RECIPIENT_NOT_FOUND);
  });

  it('reuses existing transfers when clientReference matches', async () => {
    const server = getServer();
    const password = 'Password123!';
    const senderEmail = `idem-sender-${Date.now()}@example.com`;
    const recipientEmail = `idem-recipient-${Date.now()}@example.com`;

    await registerAndVerifyUser(server, {
      email: senderEmail,
      password,
      firstName: 'Idem',
      lastName: 'Sender',
    });
    await registerAndVerifyUser(server, {
      email: recipientEmail,
      password,
      firstName: 'Idem',
      lastName: 'Recipient',
    });

    const senderToken = await loginUser(server, senderEmail, password);
    await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${senderToken}`)
      .expect(200);

    const senderWallet = await prisma.wallet.findFirstOrThrow({
      where: { user: { email: senderEmail.toLowerCase() } },
    });
    await prisma.wallet.update({
      where: { id: senderWallet.id },
      data: { availableBalanceMinor: 300_000 },
    });

    const clientReference = `idem-${Date.now()}`;
    const transfer = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `idem-${Date.now()}`)
      .send({
        recipient: { email: recipientEmail },
        amountMinor: 150_000,
        currency: 'IDR',
        clientReference,
      })
      .expect(201);

    const replay = await request(server)
      .post('/v1/transactions/transfer')
      .set('Authorization', `Bearer ${senderToken}`)
      .set('Idempotency-Key', `idem-${Date.now() + 1}`)
      .send({
        recipient: { email: recipientEmail },
        amountMinor: 150_000,
        currency: 'IDR',
        clientReference,
      })
      .expect(201);

    expect(replay.body.data.transactionId).toBe(transfer.body.data.transactionId);
    expect(replay.body.data.clientReference).toBe(clientReference);

    const walletAfter = await request(server)
      .get('/v1/wallets/me')
      .set('Authorization', `Bearer ${senderToken}`)
      .expect(200);
    expect(walletAfter.body.data.availableBalanceMinor).toBe(150_000);
  });
});
