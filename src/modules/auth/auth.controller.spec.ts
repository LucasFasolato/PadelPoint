import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ForbiddenException } from '@nestjs/common';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    loginPlayer: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      loginPlayer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('allows PLAYER login via /auth/login-user', async () => {
    authService.loginPlayer.mockResolvedValue({ accessToken: 'token-123' });

    await expect(
      controller.loginUser({ email: 'player@test.com', password: 'secret' }),
    ).resolves.toEqual({ accessToken: 'token-123' });
  });

  it('rejects non-PLAYER via /auth/login-user with 403', async () => {
    authService.loginPlayer.mockRejectedValue(
      new ForbiddenException('Only player accounts allowed'),
    );

    await expect(
      controller.loginUser({ email: 'admin@test.com', password: 'secret' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('login-user returns the same shape as login-player', async () => {
    const payload = { accessToken: 'token-123' };
    authService.loginPlayer.mockResolvedValue(payload);

    const playerRes = await controller.loginPlayer({
      email: 'player@test.com',
      password: 'secret',
    });
    const userRes = await controller.loginUser({
      email: 'player@test.com',
      password: 'secret',
    });

    expect(Object.keys(userRes)).toEqual(Object.keys(playerRes));
  });
});
