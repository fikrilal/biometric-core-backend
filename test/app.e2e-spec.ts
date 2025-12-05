import { Test } from '@nestjs/testing';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { Logger } from 'nestjs-pino';
import { MockEmailService } from '../src/auth-password/email.service';

describe('App e2e (health)', () => {
  console.log('TEST DATABASE_URL', process.env.DATABASE_URL);
  let app: INestApplication;
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
      'postgresql://postgres:postgres@localhost:5432/biometric_core?schema=public';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  afterAll(async () => {
    await app.close();
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
});
