import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.enum';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
    };
    jwtService = { sign: jest.fn() };
    process.env.JWT_SECRET = 'test-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('allows PLAYER login via loginPlayer', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'player-id',
      email: 'player@test.com',
      passwordHash: 'hash',
      role: UserRole.PLAYER,
      active: true,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    jwtService.sign.mockReturnValue('token-123');

    const result = await service.loginPlayer({
      email: 'player@test.com',
      password: 'secret',
    });

    expect(result).toEqual({
      accessToken: 'token-123',
    });
  });

  it('rejects ADMIN login via loginPlayer with 403', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'admin-id',
      email: 'admin@test.com',
      passwordHash: 'hash',
      role: UserRole.ADMIN,
      active: true,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.loginPlayer({ email: 'admin@test.com', password: 'secret' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
