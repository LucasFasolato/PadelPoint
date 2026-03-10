import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { setupOpenApi } from '@/openapi/openapi';
import { OriginCsrfGuard } from '@/common/guards/origin-csrf.guard';
import { ensureRequestContext } from '@/common/observability/request-context.util';

const bootLogger = new Logger('Bootstrap');

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function bootstrap() {
  const gitSha = process.env.GIT_SHA ?? process.env.COMMIT_SHA ?? 'unknown';
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  bootLogger.log(`Starting PadelPoint backend sha=${gitSha} env=${nodeEnv}`);

  const app = await NestFactory.create(AppModule);
  const cookieParserMiddleware = cookieParser() as (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;
  const corsOptions: CorsOptions = {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ): void => {
      // Allow non-browser requests (curl, server-to-server, swagger-internal)
      if (!origin) {
        callback(null, true);
        return;
      }

      const reqOrigin = normalizeOrigin(origin);

      if (!allowedOrigin) {
        console.log('[CORS] blocked origin (APP_URL missing):', reqOrigin);
        callback(new Error('Not allowed by CORS'), false);
        return;
      }

      if (reqOrigin === allowedOrigin) {
        callback(null, true);
        return;
      }

      console.log(
        '[CORS] blocked origin:',
        reqOrigin,
        'allowed:',
        allowedOrigin,
      );
      callback(new Error('Not allowed by CORS'), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  };

  app.use(cookieParserMiddleware);
  app.use((req: Request, res: Response, next: NextFunction) => {
    ensureRequestContext(req, res);
    next();
  });

  const appUrlRaw = process.env.APP_URL ?? '';
  const allowedOrigin = appUrlRaw ? normalizeOrigin(appUrlRaw) : '';

  app.enableCors(corsOptions);
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
