import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { UsersService } from '../../users/services/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { AuthProvider } from '../enums/auth-provider.enum';
import { UserRole } from '../../users/enums/user-role.enum';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const playerUser = {
  id: 'player-id',
  email: 'player@test.com',
  passwordHash: null,
  role: UserRole.PLAYER,
  active: true,
};

const adminUser = {
  id: 'admin-id',
  email: 'admin@test.com',
  passwordHash: null,
  role: UserRole.ADMIN,
  active: true,
};

const passwordIdentity = {
  id: 'identity-id',
  userId: 'player-id',
  provider: AuthProvider.PASSWORD,
  email: 'player@test.com',
  passwordHash: 'hashed-pw',
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
  };
  let jwtService: { sign: jest.Mock };
  let identityRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let refreshTokenService: { createRefreshToken: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
    };
    jwtService = { sign: jest.fn().mockReturnValue('access-token') };
    identityRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    refreshTokenService = {
      createRefreshToken: jest.fn().mockResolvedValue('refresh-token'),
    };
    process.env.JWT_SECRET = 'test-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: getRepositoryToken(AuthIdentity), useValue: identityRepo },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('creates user with null passwordHash, creates identity, returns tokens', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...playerUser });
      (bcrypt.hash as jest.Mock).mockResolvedValue('bcrypt-hash');

      const result = await service.register({
        email: 'player@test.com',
        password: 'secret',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          passwordHash: null,
          email: 'player@test.com',
        }),
      );
      expect(identityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: AuthProvider.PASSWORD,
          passwordHash: 'bcrypt-hash',
        }),
      );
      expect(identityRepo.save).toHaveBeenCalled();
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.email).toBe('player@test.com');
    });

    it('throws 400 when email already in use', async () => {
      usersService.findByEmail.mockResolvedValue(playerUser);

      await expect(
        service.register({ email: 'player@test.com', password: 'secret' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('login', () => {
    it('returns access and refresh tokens for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(playerUser);
      identityRepo.findOne.mockResolvedValue(passwordIdentity);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'player@test.com',
        password: 'secret',
      });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.userId).toBe('player-id');
    });

    it('throws 401 for wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(playerUser);
      identityRepo.findOne.mockResolvedValue(passwordIdentity);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'player@test.com', password: 'wrong' }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws 401 for unknown user', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@test.com', password: 'secret' }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('throws AUTH_PROVIDER_REQUIRED when PASSWORD identity is missing', async () => {
      usersService.findByEmail.mockResolvedValue(playerUser);
      identityRepo.findOne.mockResolvedValue(null);
      identityRepo.find.mockResolvedValue([
        { provider: AuthProvider.GOOGLE, userId: 'player-id' },
      ]);

      await expect(
        service.login({ email: 'player@test.com', password: 'secret' }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({
          code: 'AUTH_PROVIDER_REQUIRED',
          providers: [AuthProvider.GOOGLE],
        }),
      });
    });
  });

  describe('loginPlayer', () => {
    it('allows PLAYER role', async () => {
      usersService.findByEmail.mockResolvedValue(playerUser);
      identityRepo.findOne.mockResolvedValue(passwordIdentity);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.loginPlayer({
        email: 'player@test.com',
        password: 'secret',
      });

      expect(result.user.role).toBe(UserRole.PLAYER);
    });

    it('rejects ADMIN role with 403', async () => {
      usersService.findByEmail.mockResolvedValue(adminUser);
      identityRepo.findOne.mockResolvedValue({
        ...passwordIdentity,
        userId: 'admin-id',
        email: 'admin@test.com',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.loginPlayer({ email: 'admin@test.com', password: 'secret' }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('issueAccessToken', () => {
    it('returns accessToken and user without creating a refresh token', () => {
      const result = service.issueAccessToken(
        'uid',
        'u@test.com',
        UserRole.PLAYER,
      );

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'uid', email: 'u@test.com' }),
      );
      expect(result.accessToken).toBe('access-token');
      expect(refreshTokenService.createRefreshToken).not.toHaveBeenCalled();
    });
  });
});
