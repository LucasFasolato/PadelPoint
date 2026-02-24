import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { PlayersMeProfileController } from '../src/modules/players/players-me-profile.controller';
import { PlayersService } from '../src/modules/players/players.service';

const FAKE_PLAYER = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'player@test.com',
  role: 'player',
};

describe('Players Profile (e2e)', () => {
  let app: INestApplication<App>;
  let playersService: Partial<Record<keyof PlayersService, jest.Mock>>;

  beforeEach(async () => {
    playersService = {
      getMyProfile: jest.fn(),
      updateMyProfile: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PlayersMeProfileController],
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

  it('GET /players/me/profile returns the player profile', async () => {
    playersService.getMyProfile!.mockResolvedValue({
      userId: FAKE_PLAYER.userId,
      bio: null,
      playStyleTags: [],
      strengths: [],
      lookingFor: { partner: false, rival: false },
      location: { city: null, province: null, country: null },
      updatedAt: '2026-02-24T10:00:00.000Z',
    });

    const res = await request(app.getHttpServer())
      .get('/players/me/profile')
      .expect(200);

    expect(res.body.userId).toBe(FAKE_PLAYER.userId);
    expect(playersService.getMyProfile).toHaveBeenCalledWith(FAKE_PLAYER.userId);
  });

  it('PATCH /players/me/profile updates fields and sends normalized payload to service', async () => {
    playersService.updateMyProfile!.mockResolvedValue({
      userId: FAKE_PLAYER.userId,
      bio: 'Juego paciente',
      playStyleTags: ['aggressive', 'net-player'],
      strengths: ['Bandeja', 'Globo'],
      lookingFor: { partner: true, rival: false },
      location: { city: 'Buenos Aires', province: null, country: 'Argentina' },
      updatedAt: '2026-02-24T11:00:00.000Z',
    });

    const res = await request(app.getHttpServer())
      .patch('/players/me/profile')
      .send({
        bio: '  Juego paciente  ',
        playStyleTags: [' Aggressive ', 'NET-PLAYER '],
        strengths: [' Bandeja ', 'Globo'],
        lookingFor: { partner: true },
        location: { city: ' Buenos Aires ', country: ' Argentina ' },
      })
      .expect(200);

    expect(res.body.playStyleTags).toEqual(['aggressive', 'net-player']);
    expect(playersService.updateMyProfile).toHaveBeenCalledWith(
      FAKE_PLAYER.userId,
      expect.objectContaining({
        bio: 'Juego paciente',
        playStyleTags: ['aggressive', 'net-player'],
        strengths: ['Bandeja', 'Globo'],
        lookingFor: expect.objectContaining({ partner: true }),
        location: expect.objectContaining({
          city: 'Buenos Aires',
          country: 'Argentina',
        }),
      }),
    );
  });

  it('PATCH /players/me/profile rejects too many style tags', async () => {
    await request(app.getHttpServer())
      .patch('/players/me/profile')
      .send({
        playStyleTags: [
          'aggressive',
          'defensive',
          'balanced',
          'counterpuncher',
          'net-player',
          'baseline',
          'left-side',
          'right-side',
          'lobber',
          'smash-focused',
          'tactical',
        ],
      })
      .expect(400);

    expect(playersService.updateMyProfile).not.toHaveBeenCalled();
  });

  it('PATCH /players/me/profile rejects bio longer than 240', async () => {
    await request(app.getHttpServer())
      .patch('/players/me/profile')
      .send({ bio: 'a'.repeat(241) })
      .expect(400);

    expect(playersService.updateMyProfile).not.toHaveBeenCalled();
  });
});

