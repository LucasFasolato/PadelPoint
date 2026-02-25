import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from '../services/auth.service';
import { RefreshTokenService } from '../services/refresh-token.service';
import { UsersService } from '../../users/services/users.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UserRole } from '../../users/enums/user-role.enum';
import type { Response } from 'express';

function makeRes(): jest.Mocked<Pick<Response, 'cookie' | 'clearCookie'>> {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as never;
}

function makeReq(cookies: Record<string, string> = {}) {
  return { cookies } as never;
}

const tokens = {
  accessToken: 'at-token',
  refreshToken: 'rt-token',
  user: { userId: 'uid', email: 'u@test.com', role: UserRole.PLAYER },
};

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    loginPlayer: jest.Mock;
    issueAccessToken: jest.Mock;
  };
  let refreshTokenService: {
    rotate: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let usersService: { findById: jest.Mock };

  beforeEach(async () => {
    authService = {
      register: jest.fn().mockResolvedValue(tokens),
      login: jest.fn().mockResolvedValue(tokens),
      loginPlayer: jest.fn().mockResolvedValue(tokens),
      issueAccessToken: jest.fn().mockReturnValue({ accessToken: 'at-token', user: tokens.user }),
    };
    refreshTokenService = {
      rotate: jest.fn().mockResolvedValue({ newPlaintext: 'new-rt', userId: 'uid' }),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn(),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({ id: 'uid', email: 'u@test.com', role: UserRole.PLAYER, active: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: UsersService, useValue: usersService },
        { provide: JwtAuthGuard, useValue: { canActivate: jest.fn(() => true) } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('sets pp_at and pp_rt cookies and returns accessToken + user', async () => {
      const res = makeRes();
      const result = await controller.register(
        { email: 'u@test.com', password: 'secret' },
        res as never,
      );

      expect(res.cookie).toHaveBeenCalledWith('pp_at', 'at-token', expect.objectContaining({ httpOnly: true }));
      expect(res.cookie).toHaveBeenCalledWith('pp_rt', 'rt-token', expect.objectContaining({ httpOnly: true }));
      expect(result).toEqual({ accessToken: 'at-token', user: tokens.user });
    });
  });

  describe('login', () => {
    it('sets cookies and returns response body', async () => {
      const res = makeRes();
      const result = await controller.login({ email: 'u@test.com', password: 'secret' }, res as never);

      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(result.accessToken).toBe('at-token');
    });

    it('bubbles up 401 from service', async () => {
      authService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));
      const res = makeRes();

      await expect(
        controller.login({ email: 'x@test.com', password: 'bad' }, res as never),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('loginPlayer', () => {
    it('sets cookies on success', async () => {
      const res = makeRes();
      await controller.loginPlayer({ email: 'u@test.com', password: 'secret' }, res as never);

      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('bubbles 403 for non-PLAYER', async () => {
      authService.loginPlayer.mockRejectedValue(new ForbiddenException('Only player accounts allowed'));
      const res = makeRes();

      await expect(
        controller.loginPlayer({ email: 'admin@test.com', password: 'secret' }, res as never),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('refresh', () => {
    it('rotates RT, issues new AT, sets both cookies', async () => {
      const res = makeRes();
      const result = await controller.refresh(makeReq({ pp_rt: 'old-rt' }), res as never);

      expect(refreshTokenService.rotate).toHaveBeenCalledWith('old-rt');
      expect(authService.issueAccessToken).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('pp_at', 'at-token', expect.any(Object));
      expect(res.cookie).toHaveBeenCalledWith('pp_rt', 'new-rt', expect.any(Object));
      expect(result.accessToken).toBe('at-token');
    });

    it('throws 401 when pp_rt cookie is absent', async () => {
      const res = makeRes();

      await expect(controller.refresh(makeReq(), res as never)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws 401 when rotate rejects (invalid token)', async () => {
      refreshTokenService.rotate.mockRejectedValue(new UnauthorizedException());
      const res = makeRes();

      await expect(
        controller.refresh(makeReq({ pp_rt: 'bad' }), res as never),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws 401 when user is inactive after rotation', async () => {
      usersService.findById.mockResolvedValue({ ...tokens.user, active: false });
      const res = makeRes();

      await expect(
        controller.refresh(makeReq({ pp_rt: 'valid-rt' }), res as never),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('logout', () => {
    it('revokes RT and clears cookies', async () => {
      const res = makeRes();
      const result = await controller.logout(makeReq({ pp_rt: 'old-rt' }), res as never);

      expect(refreshTokenService.revoke).toHaveBeenCalledWith('old-rt');
      expect(res.clearCookie).toHaveBeenCalledWith('pp_at', expect.any(Object));
      expect(res.clearCookie).toHaveBeenCalledWith('pp_rt', expect.any(Object));
      expect(result).toEqual({ ok: true });
    });

    it('clears cookies even when no RT cookie present', async () => {
      const res = makeRes();
      const result = await controller.logout(makeReq(), res as never);

      expect(refreshTokenService.revoke).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
    });

    it('clears cookies even when revoke fails (best-effort)', async () => {
      refreshTokenService.revoke.mockRejectedValue(new Error('DB down'));
      const res = makeRes();

      await expect(
        controller.logout(makeReq({ pp_rt: 'rt' }), res as never),
      ).resolves.toEqual({ ok: true });
      expect(res.clearCookie).toHaveBeenCalledTimes(2);
    });
  });
});
