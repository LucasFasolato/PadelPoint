import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { MeActivityController } from '@/modules/core/notifications/controllers/me-activity.controller';
import { ActivityFeedService } from '@/modules/core/notifications/services/activity-feed.service';

const FAKE_USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'player@test.com',
  role: 'player',
};

describe('Me Activity (e2e)', () => {
  let app: INestApplication<App>;
  let activityFeedService: Partial<Record<keyof ActivityFeedService, jest.Mock>>;

  beforeEach(async () => {
    activityFeedService = {
      listForUser: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MeActivityController],
      providers: [{ provide: ActivityFeedService, useValue: activityFeedService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = FAKE_USER;
          return true;
        },
      })
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

  it('GET /me/activity returns newest-first compact feed', async () => {
    activityFeedService.listForUser!.mockResolvedValue({
      items: [
        {
          id: 'n-1',
          type: 'RANKING_MOVEMENT',
          title: 'You moved up 2 positions',
          body: 'Now ranked #8',
          metadata: { deltaPositions: 2, newPosition: 8 },
          createdAt: '2026-02-27T03:00:00.000Z',
          isGlobal: false,
        },
      ],
      nextCursor: '2026-02-27T03:00:00.000Z|n-1',
    });

    const res = await request(app.getHttpServer())
      .get('/me/activity?limit=20')
      .expect(200);

    expect(res.body.items[0]).toEqual(
      expect.objectContaining({
        type: 'RANKING_MOVEMENT',
        title: expect.any(String),
        metadata: expect.any(Object),
      }),
    );
    expect(activityFeedService.listForUser).toHaveBeenCalledWith(
      FAKE_USER.userId,
      expect.objectContaining({ limit: 20 }),
    );
  });
});

