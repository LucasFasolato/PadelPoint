import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMockRepo } from '@/test-utils/mock-repo';
import { User } from '../../users/entities/user.entity';
import { PlayerProfile } from '../entities/player-profile.entity';
import { PlayersService } from './players.service';
import { PlayerFavorite } from '../entities/player-favorite.entity';
import { decodePlayerFavoritesCursor } from '../utils/player-favorites-cursor.util';
import { Country } from '../../geo/entities/country.entity';
import { Province } from '../../geo/entities/province.entity';
import { City } from '../../geo/entities/city.entity';

describe('PlayersService', () => {
  let service: PlayersService;
  const userRepo = createMockRepo<User>();
  const profileRepo = createMockRepo<PlayerProfile>();
  const favoriteRepo = createMockRepo<PlayerFavorite>();
  const countryRepo = createMockRepo<Country>();
  const provinceRepo = createMockRepo<Province>();
  const cityRepo = createMockRepo<City>();

  beforeEach(async () => {
    userRepo.findOne.mockReset();
    profileRepo.findOne.mockReset();
    profileRepo.create.mockReset();
    profileRepo.save.mockReset();
    favoriteRepo.create.mockReset();
    favoriteRepo.find.mockReset();
    favoriteRepo.save.mockReset();
    favoriteRepo.delete.mockReset();
    favoriteRepo.manager.query.mockReset();
    countryRepo.findOne.mockReset();
    countryRepo.create.mockReset();
    countryRepo.save.mockReset();
    countryRepo.createQueryBuilder.mockReset();
    provinceRepo.findOne.mockReset();
    provinceRepo.create.mockReset();
    provinceRepo.save.mockReset();
    provinceRepo.createQueryBuilder.mockReset();
    cityRepo.findOne.mockReset();
    cityRepo.create.mockReset();
    cityRepo.save.mockReset();
    cityRepo.createQueryBuilder.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(PlayerProfile),
          useValue: profileRepo,
        },
        {
          provide: getRepositoryToken(PlayerFavorite),
          useValue: favoriteRepo,
        },
        {
          provide: getRepositoryToken(Country),
          useValue: countryRepo,
        },
        {
          provide: getRepositoryToken(Province),
          useValue: provinceRepo,
        },
        {
          provide: getRepositoryToken(City),
          useValue: cityRepo,
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
    countryRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'country-ar',
        name: 'Argentina',
      } as Country),
    });
    provinceRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'province-cba',
        name: 'Cordoba',
        countryId: 'country-ar',
      } as Province),
    });
    cityRepo.findOne.mockResolvedValue({
      id: 'city-cba',
      provinceId: 'province-cba',
      name: 'Cordoba',
      normalizedName: 'cordoba',
    } as City);

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
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', cityId: 'city-cba' }),
    );
    expect(result.lookingFor).toEqual({ partner: true, rival: true });
    expect(result.location).toEqual({
      city: 'Cordoba',
      province: 'Cordoba',
      country: 'AR',
    });
  });

  it('upserts city from location and sets users.cityId when city does not exist', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', cityId: null } as User);
    profileRepo.findOne.mockResolvedValue({
      userId: 'u1',
      bio: null,
      playStyleTags: [],
      strengths: [],
      lookingFor: { partner: false, rival: false },
      location: null,
      updatedAt: new Date('2026-02-24T12:00:00.000Z'),
    } as PlayerProfile);
    profileRepo.save.mockImplementation(async (input) => ({
      ...input,
      updatedAt: new Date('2026-02-24T13:00:00.000Z'),
    }));
    countryRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'country-ar',
        name: 'Argentina',
      } as Country),
    });
    provinceRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'province-sf',
        name: 'Santa Fe',
        code: 'S',
        countryId: 'country-ar',
      } as Province),
    });
    cityRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'city-rosario',
      provinceId: 'province-sf',
      name: 'Rosario',
      normalizedName: 'rosario',
    } as City);
    cityRepo.create.mockImplementation((input) => input);
    cityRepo.save.mockResolvedValue({
      id: 'city-rosario',
      provinceId: 'province-sf',
      name: 'Rosario',
      normalizedName: 'rosario',
    } as City);

    await service.updateMyProfile('u1', {
      location: {
        provinceCode: 'S',
        cityName: '  rosario  ',
      },
    });

    expect(cityRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provinceId: 'province-sf',
        name: 'Rosario',
        normalizedName: 'rosario',
      }),
    );
    expect(cityRepo.save).toHaveBeenCalledTimes(1);
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', cityId: 'city-rosario' }),
    );
  });

  it('rejects favoriting self with code PLAYER_FAVORITE_SELF', async () => {
    await expect(service.addFavorite('u1', 'u1')).rejects.toMatchObject({
      response: { code: 'PLAYER_FAVORITE_SELF' },
    });

    expect(favoriteRepo.save).not.toHaveBeenCalled();
  });

  it('POST addFavorite is idempotent', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u2' } as User);
    favoriteRepo.create.mockImplementation((input) => input);
    favoriteRepo.save
      .mockResolvedValueOnce({
        id: 'fav-1',
        userId: 'u1',
        favoriteUserId: 'u2',
      } as PlayerFavorite)
      .mockRejectedValueOnce({ code: '23505' });

    await expect(service.addFavorite('u1', 'u2')).resolves.toEqual({ ok: true });
    await expect(service.addFavorite('u1', 'u2')).resolves.toEqual({ ok: true });
  });

  it('DELETE removeFavorite is idempotent', async () => {
    favoriteRepo.delete.mockResolvedValue({ affected: 1 });

    await expect(service.removeFavorite('u1', 'u2')).resolves.toEqual({ ok: true });
    await expect(service.removeFavorite('u1', 'u2')).resolves.toEqual({ ok: true });

    expect(favoriteRepo.delete).toHaveBeenCalledWith({
      userId: 'u1',
      favoriteUserId: 'u2',
    });
  });

  it('listFavoriteIds returns most recent ids first and caps at 500', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      favoriteUserId: `u-${index + 1}`,
    })) as PlayerFavorite[];
    favoriteRepo.find.mockResolvedValue(rows);

    const result = await service.listFavoriteIds('u1');

    expect(favoriteRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 500,
      }),
    );
    expect(result.ids).toHaveLength(500);
    expect(result.ids[0]).toBe('u-1');
    expect(result.ids[499]).toBe('u-500');
  });

  it('lists favorites ordered by createdAt DESC/id DESC with cursor pagination and no overlap', async () => {
    const rows = [
      {
        favoriteId: 'fav-c',
        userId: 'u3',
        createdAt: '2026-02-24T12:00:00.000Z',
        displayName: 'Carlos',
        elo: 1300,
        location: { city: 'Cordoba', country: 'AR' },
      },
      {
        favoriteId: 'fav-b',
        userId: 'u2',
        createdAt: '2026-02-24T12:00:00.000Z',
        displayName: null,
        elo: null,
        location: { city: null, province: null, country: null },
      },
      {
        favoriteId: 'fav-a',
        userId: 'u4',
        createdAt: '2026-02-24T11:59:00.000Z',
        displayName: 'Ana',
        elo: 1500,
        location: null,
      },
    ];

    favoriteRepo.manager.query.mockImplementation(async (_sql, params: unknown[]) => {
      const [, maybeCursorCreatedAt, maybeCursorId, maybeLimitOrUndefined] = params;
      const hasCursor = params.length === 4;
      const limit = Number(hasCursor ? maybeLimitOrUndefined : maybeCursorCreatedAt);
      const cursorCreatedAt = hasCursor ? String(maybeCursorCreatedAt) : null;
      const cursorId = hasCursor ? String(maybeCursorId) : null;

      let filtered = rows;
      if (cursorCreatedAt && cursorId) {
        filtered = rows.filter((row) => {
          if (row.createdAt !== cursorCreatedAt) return row.createdAt < cursorCreatedAt;
          return row.favoriteId < cursorId;
        });
      }

      return filtered.slice(0, limit);
    });

    const page1 = await service.listFavorites('u1', { limit: 2 });
    expect(page1.items.map((item) => item.userId)).toEqual(['u3', 'u2']);
    expect(page1.items[1]).toMatchObject({
      displayName: 'Player',
      avatarUrl: null,
      location: null,
    });
    expect(page1.nextCursor).toEqual(expect.any(String));

    const decoded = decodePlayerFavoritesCursor(page1.nextCursor!);
    expect(decoded).toEqual({
      createdAt: '2026-02-24T12:00:00.000Z',
      id: 'fav-b',
    });

    const page2 = await service.listFavorites('u1', {
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.map((item) => item.userId)).toEqual(['u4']);
    expect(page2.nextCursor).toBeNull();

    const overlap = page1.items
      .map((item) => item.userId)
      .filter((userId) => page2.items.some((item) => item.userId === userId));
    expect(overlap).toEqual([]);
  });
});
