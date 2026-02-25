import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMockRepo } from '@/test-utils/mock-repo';
import { User } from '../users/user.entity';
import { PlayerProfile } from './player-profile.entity';
import { PlayersService } from './players.service';
import { PlayerFavorite } from './player-favorite.entity';
import { decodePlayerFavoritesCursor } from './player-favorites-cursor.util';

describe('PlayersService', () => {
  let service: PlayersService;
  const userRepo = createMockRepo<User>();
  const profileRepo = createMockRepo<PlayerProfile>();
  const favoriteRepo = createMockRepo<PlayerFavorite>();

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
