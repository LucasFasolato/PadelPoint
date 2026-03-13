import {
  BadRequestException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AuthIdentitiesController } from './auth-identities.controller';
import { AuthIdentitiesService } from '../services/auth-identities.service';
import { AuthProvider } from '../enums/auth-provider.enum';

const FAKE_USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'player@example.com',
  role: 'player',
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

describe('Auth identities contract', () => {
  let app: INestApplication<App>;
  let identitiesService: Record<string, jest.Mock>;

  beforeEach(async () => {
    identitiesService = {
      listForUser: jest.fn(),
      unlinkForUser: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthIdentitiesController],
      providers: [
        { provide: AuthIdentitiesService, useValue: identitiesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
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

  it('stabilizes GET /auth/identities response shape', async () => {
    const payload = [
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
    ];
    identitiesService.listForUser.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get('/auth/identities')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(identitiesService.listForUser).toHaveBeenCalledWith(
      FAKE_USER.userId,
    );
  });

  it('stabilizes POST /auth/identities/:id/unlink success response', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/identities/identity-google/unlink')
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(identitiesService.unlinkForUser).toHaveBeenCalledWith(
      FAKE_USER.userId,
      'identity-google',
    );
  });

  it('returns 404 when unlinking an identity outside the current user scope', async () => {
    identitiesService.unlinkForUser.mockRejectedValue(
      new NotFoundException('Identity not found'),
    );

    const res = await request(app.getHttpServer())
      .post('/auth/identities/foreign-identity/unlink')
      .expect(404);

    expect(res.body.message).toBe('Identity not found');
    expect(identitiesService.unlinkForUser).toHaveBeenCalledWith(
      FAKE_USER.userId,
      'foreign-identity',
    );
  });

  it('returns 400 when trying to unlink the last remaining identity', async () => {
    identitiesService.unlinkForUser.mockRejectedValue(
      new BadRequestException('Cannot unlink the last remaining auth identity'),
    );

    const res = await request(app.getHttpServer())
      .post('/auth/identities/identity-password/unlink')
      .expect(400);

    expect(res.body.message).toBe(
      'Cannot unlink the last remaining auth identity',
    );
  });
});
