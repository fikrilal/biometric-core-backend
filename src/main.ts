import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const config = new DocumentBuilder()
    .setTitle('Biometric Core Backend')
    .setDescription('API documentation')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const configService = app.get(ConfigService);
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  const port = configService.get<number>('PORT', 3000);
  // Fastify notFound -> ProblemDetails
  const fastify = app.getHttpAdapter().getInstance();
  if (typeof fastify.setNotFoundHandler === 'function') {
    fastify.setNotFoundHandler((req: any, reply: any) => {
      const traceId = req?.headers?.['x-request-id'] || randomUUID();
      reply
        .header('X-Request-Id', traceId)
        .header('Content-Type', 'application/problem+json')
        .status(404)
        .send({ type: 'about:blank', title: 'Not Found', status: 404, traceId });
    });
  }
  await app.listen({ port, host: '0.0.0.0' });
}

bootstrap();
