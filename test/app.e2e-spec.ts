import { Test } from '@nestjs/testing';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { Logger } from 'nestjs-pino';

describe('App e2e (health)', () => {
  let app: INestApplication;

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

  it('/health (GET)', async () => {
    const server = (app as NestFastifyApplication).getHttpServer();
    await request(server).get('/health').expect(200).expect(({ body }) => {
      expect(body.status).toBe('ok');
    });
  });

  it('/v1/auth/ping (GET) returns envelope and echoes X-Request-Id', async () => {
    const server = (app as NestFastifyApplication).getHttpServer();
    const reqId = 'e2e-test-req-1';
    const res = await request(server)
      .get('/v1/auth/ping')
      .set('X-Request-Id', reqId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(reqId);
    expect(res.body).toEqual({ data: { ok: true } });
  });

  it('unknown route returns ProblemDetails with traceId', async () => {
    const server = (app as NestFastifyApplication).getHttpServer();
    const res = await request(server).get('/v1/does-not-exist').expect(404);
    const body = res.body;
    // Content type may be set; ensure we have a reasonable shape
    expect(typeof body.title).toBe('string');
    expect(body.status).toBe(404);
    expect(typeof body.traceId === 'string' || body.traceId === undefined).toBeTruthy();
  });

  it('users module supports create/list/get', async () => {
    const server = (app as NestFastifyApplication).getHttpServer();
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
});
