import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { createMockRepo } from '@/test-utils/mock-repo';

describe('UsersService', () => {
  let service: UsersService;
  const userRepo = createMockRepo<User>();

  beforeEach(async () => {
    userRepo.findOne.mockReset();
    userRepo.save.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns player profile', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'player@test.com',
      role: 'player',
      displayName: 'Test User',
      phone: '+54 11 1234-5678',
      createdAt: new Date('2026-02-01T10:00:00.000Z'),
    } as unknown as User);

    const result = await service.getPlayerProfile('u1');

    expect(result).toEqual({
      userId: 'u1',
      email: 'player@test.com',
      role: 'PLAYER',
      displayName: 'Test User',
      phone: '+54 11 1234-5678',
      createdAt: '2026-02-01T10:00:00.000Z',
    });
  });

  it('updates player profile fields', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'player@test.com',
      role: 'player',
      displayName: null,
      phone: null,
      createdAt: new Date('2026-02-01T10:00:00.000Z'),
    } as unknown as User);

    userRepo.save.mockImplementation((input) => Promise.resolve(input as User));

    const result = await service.updatePlayerProfile('u1', {
      displayName: 'New Name',
      phone: '+54 11 1234-5678',
    });

    expect(result.displayName).toBe('New Name');
    expect(result.phone).toBe('+54 11 1234-5678');
  });

  it('rejects invalid displayName', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'player@test.com',
      role: 'player',
    } as unknown as User);

    await expect(
      service.updatePlayerProfile('u1', { displayName: 'a' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects invalid phone', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'player@test.com',
      role: 'player',
    } as unknown as User);

    await expect(
      service.updatePlayerProfile('u1', { phone: 'abc' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
