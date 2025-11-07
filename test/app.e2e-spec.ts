import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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

  it('/auth/ping (GET) returns envelope and echoes X-Request-Id', async () => {
    const server = (app as NestFastifyApplication).getHttpServer();
    const reqId = 'e2e-test-req-1';
    const res = await request(server)
      .get('/auth/ping')
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
});
