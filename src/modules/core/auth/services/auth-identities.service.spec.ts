import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { AuthIdentitiesService } from './auth-identities.service';
import { AuthProvider } from '../enums/auth-provider.enum';

describe('AuthIdentitiesService', () => {
  let service: AuthIdentitiesService;
  let identityRepo: jest.Mocked<Repository<AuthIdentity>>;

  beforeEach(async () => {
    identityRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    } as never;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthIdentitiesService,
        {
          provide: getRepositoryToken(AuthIdentity),
          useValue: identityRepo,
        },
      ],
    }).compile();

    service = module.get(AuthIdentitiesService);
  });

  it('lists only the current user identities and exposes a minimal DTO', async () => {
    identityRepo.find.mockResolvedValue([
      {
        id: 'identity-password',
        userId: 'user-1',
        provider: AuthProvider.PASSWORD,
        email: 'player@example.com',
        createdAt: new Date('2026-03-12T10:00:00.000Z'),
      },
      {
        id: 'identity-google',
        userId: 'user-1',
        provider: AuthProvider.GOOGLE,
        email: 'player@example.com',
        createdAt: new Date('2026-03-12T10:05:00.000Z'),
      },
    ] as AuthIdentity[]);

    const result = await service.listForUser('user-1');

    expect(identityRepo.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    expect(result).toEqual([
      {
        id: 'identity-password',
        provider: AuthProvider.PASSWORD,
        email: 'player@example.com',
        createdAt: '2026-03-12T10:00:00.000Z',
        canUnlink: true,
      },
      {
        id: 'identity-google',
        provider: AuthProvider.GOOGLE,
        email: 'player@example.com',
        createdAt: '2026-03-12T10:05:00.000Z',
        canUnlink: true,
      },
    ]);
  });

  it('rejects unlink when the identity does not belong to the current user', async () => {
    identityRepo.findOne.mockResolvedValue(null);

    await expect(
      service.unlinkForUser('user-1', 'foreign-identity'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(identityRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'foreign-identity', userId: 'user-1' },
    });
    expect(identityRepo.delete).not.toHaveBeenCalled();
  });

  it('rejects unlink when it would remove the last remaining identity', async () => {
    identityRepo.findOne.mockResolvedValue({
      id: 'identity-password',
      userId: 'user-1',
      provider: AuthProvider.PASSWORD,
      email: 'player@example.com',
      createdAt: new Date('2026-03-12T10:00:00.000Z'),
    } as AuthIdentity);
    identityRepo.count.mockResolvedValue(1);

    await expect(
      service.unlinkForUser('user-1', 'identity-password'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(identityRepo.delete).not.toHaveBeenCalled();
  });

  it('unlinks an owned identity when another login method remains', async () => {
    identityRepo.findOne.mockResolvedValue({
      id: 'identity-google',
      userId: 'user-1',
      provider: AuthProvider.GOOGLE,
      email: 'player@example.com',
      createdAt: new Date('2026-03-12T10:05:00.000Z'),
    } as AuthIdentity);
    identityRepo.count.mockResolvedValue(2);
    identityRepo.delete.mockResolvedValue({ affected: 1, raw: {} } as never);

    await service.unlinkForUser('user-1', 'identity-google');

    expect(identityRepo.delete).toHaveBeenCalledWith({
      id: 'identity-google',
      userId: 'user-1',
    });
  });
});
