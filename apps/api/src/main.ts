import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SentryFilter } from './sentry.filter';

// Init Sentry only when a DSN is configured. Without DSN this is a no-op,
// so local dev and not-yet-onboarded deployments don't pay any cost.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0,
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('', { exclude: ['/health', '/webhooks/(.*)'] });
  app.enableCors({
    origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('RentFlow Agent API')
    .setDescription('Rental conversion operating system — REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, doc);

  const port = Number(process.env.PORT ?? 3001);
  // Bind on 0.0.0.0 so phones on the same WiFi (and Expo Go) can reach the API.
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 RentFlow API listening on http://0.0.0.0:${port} (docs: /docs)`);
}

bootstrap();
