import {
  HttpException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { UserRole } from '@/modules/core/users/enums/user-role.enum';
import { AuthController } from './auth.controller';
import { AuthPasswordController } from './auth-password.controller';
import { AuthService } from '../services/auth.service';
import { RefreshTokenService } from '../services/refresh-token.service';
import { UsersService } from '../../users/services/users.service';
import { PasswordResetService } from '../services/password-reset.service';
import { PasswordResetRateLimiter } from '../guards/password-reset-rate-limiter';

describe('Auth hardening integration', () => {
  let app: INestApplication<App>;
  let authService: Record<string, jest.Mock>;
  let refreshTokenService: Record<string, jest.Mock>;
  let usersService: Record<string, jest.Mock>;
  let passwordResetService: Record<string, jest.Mock>;
  let rateLimiter: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      loginPlayer: jest.fn(),
      issueAccessToken: jest.fn().mockReturnValue({
        accessToken: 'new-access-token',
        user: {
          userId: 'user-1',
          email: 'user@test.com',
          role: UserRole.PLAYER,
        },
      }),
    };
    refreshTokenService = {
      rotate: jest.fn().mockResolvedValue({
        newPlaintext: 'new-refresh-token',
        userId: 'user-1',
      }),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        role: UserRole.PLAYER,
        active: true,
      }),
    };
    passwordResetService = {
      requestReset: jest.fn().mockResolvedValue({ ok: true }),
      confirmReset: jest.fn().mockResolvedValue({ ok: true }),
      resolveRateLimitEmail: jest.fn().mockResolvedValue('user@test.com'),
    };
    rateLimiter = {
      isRequestLimited: jest.fn().mockResolvedValue(false),
      assertConfirmAllowed: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, AuthPasswordController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: UsersService, useValue: usersService },
        { provide: PasswordResetService, useValue: passwordResetService },
        { provide: PasswordResetRateLimiter, useValue: rateLimiter },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rotates refresh tokens over HTTP and sets replacement cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', ['pp_rt=old-refresh-token'])
      .expect(200);

    expect(res.body).toEqual({
      accessToken: 'new-access-token',
      user: {
        userId: 'user-1',
        email: 'user@test.com',
        role: UserRole.PLAYER,
      },
    });
    expect(refreshTokenService.rotate).toHaveBeenCalledWith(
      'old-refresh-token',
    );
    expect(usersService.findById).toHaveBeenCalledWith('user-1');
    expect(authService.issueAccessToken).toHaveBeenCalledWith(
      'user-1',
      'user@test.com',
      UserRole.PLAYER,
    );
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pp_at=new-access-token'),
        expect.stringContaining('pp_rt=new-refresh-token'),
      ]),
    );
  });

  it('clears cookies when refresh rotation rejects, including token reuse detection', async () => {
    refreshTokenService.rotate.mockRejectedValue(
      new UnauthorizedException('Refresh token reuse detected'),
    );

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', ['pp_rt=reused-refresh-token'])
      .expect(401);

    expect(res.body.message).toBe('Refresh token reuse detected');
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pp_at=;'),
        expect.stringContaining('pp_rt=;'),
      ]),
    );
  });

  it('silently returns ok when password reset request is rate-limited', async () => {
    rateLimiter.isRequestLimited.mockResolvedValue(true);

    const res = await request(app.getHttpServer())
      .post('/auth/password/reset/request')
      .send({ email: 'user@test.com' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(rateLimiter.isRequestLimited).toHaveBeenCalledWith(
      'user@test.com',
      expect.any(String),
    );
    expect(passwordResetService.requestReset).not.toHaveBeenCalled();
  });

  it('returns 429 when password reset confirm is blocked by the limiter', async () => {
    rateLimiter.assertConfirmAllowed.mockRejectedValue(
      new HttpException('Too many password reset attempts', 429),
    );

    const res = await request(app.getHttpServer())
      .post('/auth/password/reset/confirm')
      .send({ token: 'reset-token', newPassword: 'newpassword123' })
      .expect(429);

    expect(res.body.message).toBe('Too many password reset attempts');
    expect(passwordResetService.resolveRateLimitEmail).toHaveBeenCalledWith(
      'reset-token',
    );
    expect(passwordResetService.confirmReset).not.toHaveBeenCalled();
  });
});
