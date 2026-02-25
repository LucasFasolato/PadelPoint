import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OAuthService, OAuthProfile } from './oauth.service';
import { UsersService } from '../../users/services/users.service';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { AuthProvider } from '../enums/auth-provider.enum';
import { UserRole } from '../../users/enums/user-role.enum';

const googleProfile: OAuthProfile = {
  provider: AuthProvider.GOOGLE,
  providerUserId: 'google-uid-123',
  email: 'user@gmail.com',
  displayName: 'Test User',
};

const existingUser = {
  id: 'user-id',
  email: 'user@gmail.com',
  passwordHash: null,
  role: UserRole.PLAYER,
  active: true,
  displayName: 'Test User',
};

const existingIdentity = {
  id: 'identity-id',
  userId: 'user-id',
  provider: AuthProvider.GOOGLE,
  providerUserId: 'google-uid-123',
  email: 'user@gmail.com',
};

describe('OAuthService', () => {
  let service: OAuthService;
  let identityRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let usersService: {
    findById: jest.Mock;
    findByEmail: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    identityRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: getRepositoryToken(AuthIdentity), useValue: identityRepo },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('linkOrCreateFromOAuth', () => {
    it('returns linked user when identity already exists', async () => {
      identityRepo.findOne.mockResolvedValue(existingIdentity);
      usersService.findById.mockResolvedValue(existingUser);

      const result = await service.linkOrCreateFromOAuth(googleProfile);

      expect(result).toBe(existingUser);
      expect(usersService.create).not.toHaveBeenCalled();
      expect(identityRepo.save).not.toHaveBeenCalled();
    });

    it('links a new identity to existing user found by email', async () => {
      identityRepo.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existingUser);

      const result = await service.linkOrCreateFromOAuth(googleProfile);

      expect(result).toBe(existingUser);
      expect(usersService.create).not.toHaveBeenCalled();
      expect(identityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          provider: AuthProvider.GOOGLE,
          providerUserId: 'google-uid-123',
        }),
      );
    });

    it('creates a new user and identity when no match exists', async () => {
      identityRepo.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...existingUser, id: 'new-user-id' });

      const result = await service.linkOrCreateFromOAuth(googleProfile);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@gmail.com',
          passwordHash: null,
          role: UserRole.PLAYER,
          active: true,
        }),
      );
      expect(identityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'new-user-id',
          provider: AuthProvider.GOOGLE,
          providerUserId: 'google-uid-123',
        }),
      );
      expect(result.id).toBe('new-user-id');
    });

    it('uses email prefix as displayName when displayName is null', async () => {
      identityRepo.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...existingUser, id: 'new-id' });

      await service.linkOrCreateFromOAuth({ ...googleProfile, displayName: null });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'user' }), // email prefix
      );
    });

    it('handles unique constraint race on identity save by ignoring the error', async () => {
      identityRepo.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existingUser);

      const uniqueError = Object.assign(new Error('duplicate key'), { code: '23505' });
      identityRepo.save.mockRejectedValue(uniqueError);

      // Should NOT throw — unique violation on identity means it already exists
      const result = await service.linkOrCreateFromOAuth(googleProfile);
      expect(result).toBe(existingUser);
    });

    it('re-throws non-unique errors on identity save', async () => {
      identityRepo.findOne.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existingUser);

      const dbError = new Error('connection lost');
      identityRepo.save.mockRejectedValue(dbError);

      await expect(service.linkOrCreateFromOAuth(googleProfile)).rejects.toThrow('connection lost');
    });

    it('handles unique constraint race on user creation by re-fetching via email', async () => {
      identityRepo.findOne.mockResolvedValueOnce(null); // first identity lookup: none
      usersService.findByEmail.mockResolvedValueOnce(null); // first email lookup: none

      const uniqueError = Object.assign(new Error('duplicate key'), { code: '23505' });
      usersService.create.mockRejectedValue(uniqueError);

      // After failed creation, fallback identity lookup (for rotate race):
      identityRepo.findOne.mockResolvedValueOnce(null); // second identity check: still none
      // Then email fallback:
      usersService.findByEmail.mockResolvedValueOnce(existingUser);

      const result = await service.linkOrCreateFromOAuth(googleProfile);
      expect(result).toBe(existingUser);
    });

    it('skips email lookup in step 2 when email is null', async () => {
      const noEmailProfile: OAuthProfile = { ...googleProfile, email: null };
      identityRepo.findOne.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...existingUser, email: `${googleProfile.providerUserId}@oauth.local` });

      await service.linkOrCreateFromOAuth(noEmailProfile);

      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: `${googleProfile.providerUserId}@oauth.local` }),
      );
    });
  });
});
