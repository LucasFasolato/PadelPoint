import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { setupOpenApi } from '@/openapi/openapi';
import { OriginCsrfGuard } from '@/common/guards/origin-csrf.guard';

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  const appUrlRaw = process.env.APP_URL ?? '';
  const allowedOrigin = appUrlRaw ? normalizeOrigin(appUrlRaw) : '';

  app.enableCors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl, server-to-server, swagger-internal)
      if (!origin) return callback(null, true);

      const reqOrigin = normalizeOrigin(origin);

      if (!allowedOrigin) {
        // eslint-disable-next-line no-console
        console.log('[CORS] blocked origin (APP_URL missing):', reqOrigin);
        return callback(new Error('Not allowed by CORS'), false);
      }

      if (reqOrigin === allowedOrigin) return callback(null, true);

      // eslint-disable-next-line no-console
      console.log('[CORS] blocked origin:', reqOrigin, 'allowed:', allowedOrigin);

      return callback(new Error('Not allowed by CORS'), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  app.useGlobalGuards(new OriginCsrfGuard());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  setupOpenApi(app);

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
