import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { PlayersPublicController } from '@/modules/core/players/controllers/players-public.controller';
import { PlayerCompetitiveSummaryService } from '@/modules/core/players/services/player-competitive-summary.service';
import { PlayerCompetitiveProfileService } from '@/modules/core/players/services/player-competitive-profile.service';

describe('Players Competitive Profile (e2e)', () => {
  let app: INestApplication<App>;
  let profileService: Partial<Record<keyof PlayerCompetitiveProfileService, jest.Mock>>;

  beforeEach(async () => {
    profileService = {
      getProfile: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PlayersPublicController],
      providers: [
        {
          provide: PlayerCompetitiveSummaryService,
          useValue: { getSummary: jest.fn() },
        },
        {
          provide: PlayerCompetitiveProfileService,
          useValue: profileService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
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

  it('GET /players/:id/competitive-profile returns stable response shape', async () => {
    profileService.getProfile!.mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Lucas Fasolato',
      avatarUrl: 'https://cdn.test/avatar.png',
      career: {
        matchesPlayed: 124,
        wins: 82,
        losses: 39,
        draws: 3,
        winRate: 0.6613,
      },
      ranking: {
        currentPosition: 14,
        peakPosition: 9,
        elo: 1470,
      },
      streaks: {
        current: { type: 'WIN', count: 3 },
        best: { type: 'WIN', count: 7 },
      },
      activity: {
        lastPlayedAt: '2026-03-05T03:33:03.677Z',
        matchesLast30Days: 8,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/players/11111111-1111-4111-8111-111111111111/competitive-profile')
      .expect(200);

    expect(Object.keys(res.body).sort()).toMatchInlineSnapshot(`
[
  "activity",
  "avatarUrl",
  "career",
  "displayName",
  "ranking",
  "streaks",
  "userId",
]
`);
    expect(Object.keys(res.body.career).sort()).toMatchInlineSnapshot(`
[
  "draws",
  "losses",
  "matchesPlayed",
  "winRate",
  "wins",
]
`);
    expect(Object.keys(res.body.ranking).sort()).toMatchInlineSnapshot(`
[
  "currentPosition",
  "elo",
  "peakPosition",
]
`);
    expect(Object.keys(res.body.streaks).sort()).toMatchInlineSnapshot(`
[
  "best",
  "current",
]
`);
    expect(Object.keys(res.body.activity).sort()).toMatchInlineSnapshot(`
[
  "lastPlayedAt",
  "matchesLast30Days",
]
`);
    expect(profileService.getProfile).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
  });
});
