import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MatchesController } from '@/modules/core/matches/controllers/matches.controller';
import { MatchesService } from '@/modules/core/matches/services/matches.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';

const FAKE_USER = {
  userId: 'a1111111-1111-4111-a111-111111111111',
  email: 'player@test.com',
  role: 'player',
  cityId: 'city-test-1',
};

function fakeGuard() {
  return {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = FAKE_USER;
      return true;
    },
  };
}

describe('Matches Pending Confirmations (e2e)', () => {
  let app: INestApplication<App>;
  let matchesService: Partial<Record<keyof MatchesService, jest.Mock>>;

  beforeEach(async () => {
    matchesService = {
      getPendingConfirmations: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [{ provide: MatchesService, useValue: matchesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard())
      .overrideGuard(CityRequiredGuard)
      .useValue(fakeGuard())
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

  it('returns 200 with empty items when user has no pending confirmations', async () => {
    matchesService.getPendingConfirmations?.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    const res = await request(app.getHttpServer())
      .get('/matches/me/pending-confirmations?limit=10')
      .expect(200);

    expect(res.body).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(matchesService.getPendingConfirmations).toHaveBeenCalledWith(
      FAKE_USER.userId,
      { cursor: undefined, limit: 10 },
    );
  });
});
