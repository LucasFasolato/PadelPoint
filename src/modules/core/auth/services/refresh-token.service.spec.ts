import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshToken } from '../entities/refresh-token.entity';

const future = new Date(Date.now() + 99 * 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 1000);

const makeToken = (overrides: Partial<RefreshToken> = {}): RefreshToken =>
  ({
    id: 'token-id',
    userId: 'user-id',
    tokenHash: 'some-hash',
    expiresAt: future,
    revokedAt: null,
    createdAt: new Date(),
    user: {} as never,
    ...overrides,
  }) as RefreshToken;

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: getRepositoryToken(RefreshToken), useValue: repo },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRefreshToken', () => {
    it('saves a hashed token and returns plaintext', async () => {
      const plaintext = await service.createRefreshToken('user-id');

      expect(typeof plaintext).toBe('string');
      expect(plaintext.length).toBeGreaterThan(20);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-id', revokedAt: null }),
      );
      // Stored hash must differ from plaintext
      const saved = repo.save.mock.calls[0][0];
      expect(saved.tokenHash).not.toBe(plaintext);
    });
  });

  describe('validate', () => {
    it('returns token entity when valid', async () => {
      const token = makeToken();
      repo.findOne.mockResolvedValue(token);

      const result = await service.validate('some-plaintext');

      expect(result).toBe(token);
    });

    it('returns null when token not found', async () => {
      repo.findOne.mockResolvedValue(null);

      expect(await service.validate('bad-token')).toBeNull();
    });

    it('returns null when token is expired', async () => {
      repo.findOne.mockResolvedValue(makeToken({ expiresAt: past }));

      expect(await service.validate('expired-token')).toBeNull();
    });
  });

  describe('rotate', () => {
    it('revokes old token, creates new one, returns new plaintext and userId', async () => {
      const token = makeToken();
      repo.findOne.mockResolvedValue(token);

      const result = await service.rotate('valid-rt');

      // Old token revoked
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      // New token created
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(result.userId).toBe('user-id');
      expect(typeof result.newPlaintext).toBe('string');
      expect(result.newPlaintext.length).toBeGreaterThan(20);
    });

    it('throws 401 when token is invalid', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.rotate('bad-rt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('revoke', () => {
    it('calls repo.update with a tokenHash criteria and sets revokedAt', async () => {
      await service.revoke('some-plaintext');

      // The service passes IsNull() (a FindOperator), not literal null, for revokedAt criteria
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: expect.any(String) }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('revokeAllForUser', () => {
    it('calls repo.update scoped to userId and sets revokedAt', async () => {
      await service.revokeAllForUser('user-id');

      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-id' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });
});
