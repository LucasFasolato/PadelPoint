import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { RolesGuard } from '@core/auth/roles.guard';
import { PlayersFavoritesController } from '@core/players/players-favorites.controller';
import { PlayersService } from '@core/players/players.service';

const FAKE_PLAYER = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'player@test.com',
  role: 'player',
};

const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_USER_ID_2 = '33333333-3333-4333-8333-333333333333';

type FavoriteItem = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  elo: number;
  category: number;
  location: { city?: string; province?: string; country?: string } | null;
  createdAt: string;
};

describe('Players Favorites (e2e)', () => {
  let app: INestApplication<App>;
  let playersService: Partial<Record<keyof PlayersService, jest.Mock>>;
  let favorites: FavoriteItem[];

  beforeEach(async () => {
    favorites = [];

    playersService = {
      addFavorite: jest.fn(async (_userId: string, targetUserId: string) => {
        if (!favorites.some((item) => item.userId === targetUserId)) {
          favorites.unshift({
            userId: targetUserId,
            displayName: 'Target Player',
            avatarUrl: null,
            elo: 1200,
            category: 6,
            location: { city: 'Cordoba', country: 'AR' },
            createdAt: '2026-02-24T12:00:00.000Z',
          });
        }
        return { ok: true };
      }),
      removeFavorite: jest.fn(async (_userId: string, targetUserId: string) => {
        favorites = favorites.filter((item) => item.userId !== targetUserId);
        return { ok: true };
      }),
      listFavorites: jest.fn(async (_userId: string, opts: { limit?: number; cursor?: string }) => {
        if (opts.cursor === 'bad-cursor') {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PLAYER_FAVORITES_CURSOR_INVALID',
            message: 'Invalid favorites cursor',
          });
        }

        const limit = opts.limit ?? 20;
        return {
          items: favorites.slice(0, limit),
          nextCursor: null,
        };
      }),
      listFavoriteIds: jest.fn(async () => ({
        ids: favorites.map((item) => item.userId).slice(0, 500),
      })),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PlayersFavoritesController],
      providers: [{ provide: PlayersService, useValue: playersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = FAKE_PLAYER;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('adds favorite and list contains it', async () => {
    await request(app.getHttpServer())
      .post(`/players/me/favorites/${TARGET_USER_ID}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/players/me/favorites')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      userId: TARGET_USER_ID,
      displayName: 'Target Player',
    });
  });

  it('deletes favorite and list becomes empty', async () => {
    await request(app.getHttpServer())
      .post(`/players/me/favorites/${TARGET_USER_ID}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/players/me/favorites/${TARGET_USER_ID}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/players/me/favorites')
      .expect(200);

    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('adds 2 favorites and ids endpoint returns both in most recent-first order', async () => {
    await request(app.getHttpServer())
      .post(`/players/me/favorites/${TARGET_USER_ID}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/players/me/favorites/${TARGET_USER_ID_2}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/players/me/favorites/ids')
      .expect(200);

    expect(res.body).toEqual({
      ids: [TARGET_USER_ID_2, TARGET_USER_ID],
    });
  });

  it('validates limit max 50', async () => {
    await request(app.getHttpServer())
      .get('/players/me/favorites?limit=51')
      .expect(400);

    expect(playersService.listFavorites).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid cursor', async () => {
    const res = await request(app.getHttpServer())
      .get('/players/me/favorites?cursor=bad-cursor')
      .expect(400);

    expect(res.body.code).toBe('PLAYER_FAVORITES_CURSOR_INVALID');
  });
});
