import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './security.constants';
import { createCsrfMiddleware } from './csrf.middleware';

@Controller('csrf-probe')
class CsrfProbeController {
  @Get()
  getProbe() {
    return { ok: true };
  }

  @Post('submit')
  submitProbe() {
    return { ok: true };
  }
}

@Controller('auth')
class CsrfAuthController {
  @Post('login')
  login() {
    return { ok: true };
  }
}

@Controller('auth/apple')
class CsrfAppleController {
  @Post('callback')
  callback() {
    return { ok: true };
  }
}

describe('CSRF middleware integration', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        CsrfProbeController,
        CsrfAuthController,
        CsrfAppleController,
      ],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockImplementation((key: string, fallback?: unknown) => {
                if (key === 'email.appUrl') return 'https://app.test';
                if (key === 'nodeEnv') return 'production';
                return fallback;
              }),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.use(createCsrfMiddleware(moduleFixture.get(ConfigService)));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows safe GET requests and issues the CSRF cookie/header pair', async () => {
    const res = await request(app.getHttpServer())
      .get('/csrf-probe')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(res.headers[CSRF_HEADER_NAME]).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${CSRF_COOKIE_NAME}=`)]),
    );
  });

  it('rejects unsafe auth requests without a trusted origin or matching token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .expect(403);

    expect(res.body).toEqual({
      statusCode: 403,
      message: 'Invalid CSRF token',
      error: 'Forbidden',
    });
  });

  it('accepts the double-submit cookie flow for unsafe requests with a session cookie', async () => {
    await request(app.getHttpServer())
      .post('/csrf-probe/submit')
      .set('Cookie', [
        'pp_rt=session-refresh-token',
        `${CSRF_COOKIE_NAME}=csrf-token-123`,
      ])
      .set(CSRF_HEADER_NAME, 'csrf-token-123')
      .expect(201, { ok: true });
  });

  it('keeps the Apple OAuth callback exempt from CSRF rejection', async () => {
    await request(app.getHttpServer())
      .post('/auth/apple/callback')
      .set('Cookie', ['pp_rt=session-refresh-token'])
      .expect(201, { ok: true });
  });
});
