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
  // SECURITY: refuse to boot in production with a fallback JWT_SECRET.
  // The auth module would otherwise sign tokens with the literal string
  // 'change-me-in-production', which would be trivially forgeable.
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      // eslint-disable-next-line no-console
      console.error('FATAL: JWT_SECRET must be set (32+ chars) in production. Refusing to boot.');
      process.exit(1);
    }
    if (!process.env.ALLOWED_ORIGINS) {
      // eslint-disable-next-line no-console
      console.error('FATAL: ALLOWED_ORIGINS must be set in production. Refusing to boot.');
      process.exit(1);
    }
  }

  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('', { exclude: ['/health', '/webhooks/(.*)'] });
  app.enableCors({
    origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryFilter());

  // SECURITY: Swagger /docs is disabled in production by default — it
  // exposes the full API surface (every endpoint, every shape, every role
  // requirement) to anyone who can reach the host. Set
  // ENABLE_SWAGGER=true on the .env to surface it temporarily for ops
  // debugging. Local/dev keeps it on automatically.
  const swaggerEnabled =
    process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('RentFlow Agent API')
      .setDescription('Rental conversion operating system — REST API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, doc);
  }

  const port = Number(process.env.PORT ?? 3001);
  // Bind on 0.0.0.0 so phones on the same WiFi (and Expo Go) can reach the API.
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(
    `🚀 RentFlow API listening on http://0.0.0.0:${port}${swaggerEnabled ? ' (docs: /docs)' : ' (swagger disabled)'}`,
  );
}

bootstrap();
