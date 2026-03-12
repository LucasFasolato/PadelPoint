import { HttpException } from '@nestjs/common';
import { PasswordResetRateLimiter } from './password-reset-rate-limiter';

describe('PasswordResetRateLimiter', () => {
  const makeLimiter = (allowed = true) => ({
    consume: jest.fn().mockResolvedValue({
      allowed,
      count: 1,
      remaining: 1,
      resetAt: Date.now() + 1000,
    }),
  });

  it('checks both email and ip on reset request', async () => {
    const limiter = makeLimiter();
    const service = new PasswordResetRateLimiter(limiter as never);

    const result = await service.isRequestLimited(
      'Player@Test.com',
      '10.0.0.1',
    );

    expect(result).toBe(false);
    expect(limiter.consume).toHaveBeenCalledTimes(2);
    expect(limiter.consume).toHaveBeenNthCalledWith(
      1,
      'password-reset:request:email:player@test.com',
      5,
      15 * 60 * 1000,
    );
    expect(limiter.consume).toHaveBeenNthCalledWith(
      2,
      'password-reset:request:ip:10.0.0.1',
      20,
      15 * 60 * 1000,
    );
  });

  it('throws when any confirm window is exceeded', async () => {
    const limiter = {
      consume: jest
        .fn()
        .mockResolvedValueOnce({
          allowed: true,
          count: 1,
          remaining: 1,
          resetAt: Date.now() + 1000,
        })
        .mockResolvedValueOnce({
          allowed: false,
          count: 10,
          remaining: 0,
          resetAt: Date.now() + 1000,
        })
        .mockResolvedValueOnce({
          allowed: true,
          count: 1,
          remaining: 1,
          resetAt: Date.now() + 1000,
        }),
    };
    const service = new PasswordResetRateLimiter(limiter as never);

    await expect(
      service.assertConfirmAllowed({
        email: 'player@test.com',
        token: 'reset-token',
        ip: '10.0.0.1',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
