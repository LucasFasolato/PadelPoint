import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthPasswordController } from './auth-password.controller';
import { PasswordResetService } from '../services/password-reset.service';
import { PasswordResetRateLimiter } from '../guards/password-reset-rate-limiter';

describe('AuthPasswordController', () => {
  let controller: AuthPasswordController;
  let passwordResetService: {
    requestReset: jest.Mock;
    confirmReset: jest.Mock;
    resolveRateLimitEmail: jest.Mock;
  };
  let rateLimiter: {
    isRequestLimited: jest.Mock;
    assertConfirmAllowed: jest.Mock;
  };

  beforeEach(async () => {
    passwordResetService = {
      requestReset: jest.fn().mockResolvedValue({ ok: true }),
      confirmReset: jest.fn().mockResolvedValue({ ok: true }),
      resolveRateLimitEmail: jest.fn().mockResolvedValue('player@test.com'),
    };
    rateLimiter = {
      isRequestLimited: jest.fn().mockResolvedValue(false),
      assertConfirmAllowed: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthPasswordController],
      providers: [
        { provide: PasswordResetService, useValue: passwordResetService },
        { provide: PasswordResetRateLimiter, useValue: rateLimiter },
      ],
    }).compile();

    controller = module.get<AuthPasswordController>(AuthPasswordController);
  });

  it('silently returns ok when requestReset is limited', async () => {
    rateLimiter.isRequestLimited.mockResolvedValue(true);

    await expect(
      controller.requestReset({ email: 'player@test.com' }, {
        ip: '127.0.0.1',
      } as never),
    ).resolves.toEqual({ ok: true });
    expect(passwordResetService.requestReset).not.toHaveBeenCalled();
  });

  it('delegates requestReset when limiter allows it', async () => {
    await controller.requestReset({ email: 'player@test.com' }, {
      ip: '127.0.0.1',
    } as never);

    expect(rateLimiter.isRequestLimited).toHaveBeenCalledWith(
      'player@test.com',
      '127.0.0.1',
    );
    expect(passwordResetService.requestReset).toHaveBeenCalledWith(
      'player@test.com',
    );
  });

  it('checks confirmReset against email and ip before resetting', async () => {
    await controller.confirmReset({ ip: '127.0.0.1' } as never, {
      token: 'reset-token',
      newPassword: 'newpassword123',
    });

    expect(passwordResetService.resolveRateLimitEmail).toHaveBeenCalledWith(
      'reset-token',
    );
    expect(rateLimiter.assertConfirmAllowed).toHaveBeenCalledWith({
      email: 'player@test.com',
      token: 'reset-token',
      ip: '127.0.0.1',
    });
    expect(passwordResetService.confirmReset).toHaveBeenCalledWith(
      'reset-token',
      'newpassword123',
    );
  });

  it('bubbles rate-limit failures from confirmReset', async () => {
    rateLimiter.assertConfirmAllowed.mockRejectedValue(
      new HttpException(
        'Too many password reset attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    await expect(
      controller.confirmReset({ ip: '127.0.0.1' } as never, {
        token: 'reset-token',
        newPassword: 'newpassword123',
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
