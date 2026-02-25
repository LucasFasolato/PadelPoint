import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { UsersService } from '../../users/services/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { EMAIL_SENDER } from '../email/email-sender';
import { AuthProvider } from '../enums/auth-provider.enum';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'test@example.com',
  role: 'PLAYER',
  ...overrides,
});

const makeTokenRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'token-1',
  userId: 'user-1',
  tokenHash: 'some-hash',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  usedAt: null,
  user: makeUser(),
  ...overrides,
});

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let resetTokenRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let identityRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let usersService: { findByEmail: jest.Mock };
  let refreshTokenService: { revokeAllForUser: jest.Mock };
  let emailSender: { sendPasswordReset: jest.Mock };

  beforeEach(async () => {
    resetTokenRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((data) => ({ ...data })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    identityRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((data) => ({ ...data })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    usersService = { findByEmail: jest.fn() };
    refreshTokenService = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
    emailSender = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: getRepositoryToken(PasswordResetToken), useValue: resetTokenRepo },
        { provide: getRepositoryToken(AuthIdentity), useValue: identityRepo },
        { provide: UsersService, useValue: usersService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: EMAIL_SENDER, useValue: emailSender },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
      ],
    }).compile();

    service = module.get<PasswordResetService>(PasswordResetService);
  });

  // ── requestReset ─────────────────────────────────────────────────────────────

  describe('requestReset', () => {
    it('returns { ok: true } for an unknown email without sending any email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const result = await service.requestReset('nobody@example.com');

      expect(result).toEqual({ ok: true });
      expect(emailSender.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('returns { ok: true } and sends email for a known user', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser());

      const result = await service.requestReset('test@example.com');

      expect(result).toEqual({ ok: true });
      expect(emailSender.sendPasswordReset).toHaveBeenCalledTimes(1);
      const [toArg, linkArg] = emailSender.sendPasswordReset.mock.calls[0] as [string, string];
      expect(toArg).toBe('test@example.com');
      expect(linkArg).toContain('/reset-password?token=');
    });

    it('still returns { ok: true } even if the email send throws', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser());
      emailSender.sendPasswordReset.mockRejectedValue(new Error('SMTP error'));

      const result = await service.requestReset('test@example.com');

      expect(result).toEqual({ ok: true });
    });

    it('invalidates previous unused tokens before creating a new one', async () => {
      usersService.findByEmail.mockResolvedValue(makeUser());

      await service.requestReset('test@example.com');

      expect(resetTokenRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
    });
  });

  // ── confirmReset ──────────────────────────────────────────────────────────────

  describe('confirmReset', () => {
    it('throws BadRequestException for an unknown token', async () => {
      resetTokenRepo.findOne.mockResolvedValue(null);

      await expect(service.confirmReset('bad-token', 'newpassword123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for a used token', async () => {
      resetTokenRepo.findOne.mockResolvedValue(
        makeTokenRow({ usedAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.confirmReset('used-token', 'newpassword123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for an expired token', async () => {
      resetTokenRepo.findOne.mockResolvedValue(
        makeTokenRow({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.confirmReset('expired-token', 'newpassword123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a new PASSWORD identity when none exists', async () => {
      resetTokenRepo.findOne.mockResolvedValue(makeTokenRow());
      identityRepo.findOne.mockResolvedValue(null);

      await service.confirmReset('valid-token', 'newpassword123');

      expect(identityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: AuthProvider.PASSWORD,
          userId: 'user-1',
          passwordHash: 'hashed-password',
        }),
      );
      expect(identityRepo.save).toHaveBeenCalled();
    });

    it('updates an existing PASSWORD identity without creating a new one', async () => {
      const existingIdentity = {
        id: 'ident-1',
        userId: 'user-1',
        provider: AuthProvider.PASSWORD,
        email: 'test@example.com',
        passwordHash: 'old-hash',
      };
      resetTokenRepo.findOne.mockResolvedValue(makeTokenRow());
      identityRepo.findOne.mockResolvedValue(existingIdentity);

      await service.confirmReset('valid-token', 'newpassword123');

      expect(identityRepo.create).not.toHaveBeenCalled();
      expect(identityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'hashed-password' }),
      );
    });

    it('hashes the new password with bcrypt', async () => {
      resetTokenRepo.findOne.mockResolvedValue(makeTokenRow());
      identityRepo.findOne.mockResolvedValue(null);

      await service.confirmReset('valid-token', 'mynewpassword');

      expect(bcrypt.hash).toHaveBeenCalledWith('mynewpassword', 10);
    });

    it('marks the token as used after a successful reset', async () => {
      const tokenRow = makeTokenRow();
      resetTokenRepo.findOne.mockResolvedValue(tokenRow);
      identityRepo.findOne.mockResolvedValue(null);

      await service.confirmReset('valid-token', 'newpassword123');

      expect(resetTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
    });

    it('revokes all refresh tokens for the user', async () => {
      resetTokenRepo.findOne.mockResolvedValue(makeTokenRow());
      identityRepo.findOne.mockResolvedValue(null);

      await service.confirmReset('valid-token', 'newpassword123');

      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('returns { ok: true } on success', async () => {
      resetTokenRepo.findOne.mockResolvedValue(makeTokenRow());
      identityRepo.findOne.mockResolvedValue(null);

      const result = await service.confirmReset('valid-token', 'newpassword123');

      expect(result).toEqual({ ok: true });
    });
  });
});
