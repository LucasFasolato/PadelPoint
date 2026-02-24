import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMockRepo } from '@/test-utils/mock-repo';
import { User } from '../users/user.entity';
import { PlayerProfile } from './player-profile.entity';
import { PlayersService } from './players.service';

describe('PlayersService', () => {
  let service: PlayersService;
  const userRepo = createMockRepo<User>();
  const profileRepo = createMockRepo<PlayerProfile>();

  beforeEach(async () => {
    userRepo.findOne.mockReset();
    profileRepo.findOne.mockReset();
    profileRepo.create.mockReset();
    profileRepo.save.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(PlayerProfile),
          useValue: profileRepo,
        },
      ],
    }).compile();

    service = module.get<PlayersService>(PlayersService);
  });

  it('creates a default profile on first GET when missing', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1' } as User);
    profileRepo.findOne.mockResolvedValueOnce(null);
    profileRepo.create.mockImplementation((input) => input);
    profileRepo.save.mockImplementation(async (input) => ({
      ...input,
      updatedAt: new Date('2026-02-24T12:00:00.000Z'),
    }));

    const result = await service.getMyProfile('u1');

    expect(profileRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        bio: null,
        playStyleTags: [],
        strengths: [],
        lookingFor: { partner: false, rival: false },
        location: null,
      }),
    );
    expect(result).toEqual({
      userId: 'u1',
      bio: null,
      playStyleTags: [],
      strengths: [],
      lookingFor: { partner: false, rival: false },
      location: { city: null, province: null, country: null },
      updatedAt: '2026-02-24T12:00:00.000Z',
    });
  });

  it('patch updates fields and merges nested values', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1' } as User);
    profileRepo.findOne.mockResolvedValue({
      userId: 'u1',
      bio: null,
      playStyleTags: ['balanced'],
      strengths: ['volleys'],
      lookingFor: { partner: false, rival: true },
      location: { city: 'Cordoba', province: null, country: 'AR' },
      updatedAt: new Date('2026-02-24T12:00:00.000Z'),
    } as PlayerProfile);
    profileRepo.save.mockImplementation(async (input) => ({
      ...input,
      updatedAt: new Date('2026-02-24T13:00:00.000Z'),
    }));

    const result = await service.updateMyProfile('u1', {
      bio: 'Prefiero partidos largos',
      playStyleTags: ['aggressive', 'aggressive', 'net-player'] as any,
      strengths: ['Bandeja', 'Bandeja', 'Lob'],
      lookingFor: { partner: true },
      location: { province: 'Cordoba' },
    });

    expect(profileRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        bio: 'Prefiero partidos largos',
        playStyleTags: ['aggressive', 'net-player'],
        strengths: ['Bandeja', 'Lob'],
        lookingFor: { partner: true, rival: true },
        location: { city: 'Cordoba', province: 'Cordoba', country: 'AR' },
      }),
    );
    expect(result.lookingFor).toEqual({ partner: true, rival: true });
    expect(result.location).toEqual({
      city: 'Cordoba',
      province: 'Cordoba',
      country: 'AR',
    });
  });
});

