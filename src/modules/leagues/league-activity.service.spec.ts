import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LeagueActivityService } from './league-activity.service';
import { LeagueActivity } from './league-activity.entity';
import { LeagueActivityType } from './league-activity-type.enum';
import { User } from '../users/user.entity';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';

const LEAGUE_ID = 'league-1';
const ACTOR_ID = 'user-1';
const ENTITY_ID = 'match-1';

function makeQb(rows: any[] = []) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}

function fakeActivity(overrides: Partial<LeagueActivity> = {}): LeagueActivity {
  return {
    id: 'act-1',
    leagueId: LEAGUE_ID,
    type: LeagueActivityType.MATCH_CONFIRMED,
    actorId: ACTOR_ID,
    entityId: ENTITY_ID,
    payload: null,
    createdAt: new Date('2025-06-15T10:00:00.000Z'),
    ...overrides,
  } as LeagueActivity;
}

describe('LeagueActivityService', () => {
  let service: LeagueActivityService;
  let repo: MockRepo<LeagueActivity>;
  let userRepo: MockRepo<User>;
  let gateway: { emitToLeague: jest.Mock };

  beforeEach(async () => {
    repo = createMockRepo<LeagueActivity>();
    userRepo = createMockRepo<User>();
    gateway = { emitToLeague: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeagueActivityService,
        { provide: getRepositoryToken(LeagueActivity), useValue: repo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(LeagueActivityService);
  });

  // ── create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('persists the activity and emits league:activity WS event with actorName', async () => {
      const saved = fakeActivity();
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);
      userRepo.findOne.mockResolvedValue({
        id: ACTOR_ID,
        displayName: 'Alice',
        email: 'alice@example.com',
      } as User);

      const result = await service.create({
        leagueId: LEAGUE_ID,
        type: LeagueActivityType.MATCH_CONFIRMED,
        actorId: ACTOR_ID,
        entityId: ENTITY_ID,
      });

      expect(repo.save).toHaveBeenCalledWith(saved);
      expect(result).toBe(saved);
      expect(gateway.emitToLeague).toHaveBeenCalledWith(
        LEAGUE_ID,
        'league:activity',
        expect.objectContaining({ actorName: 'Alice' }),
      );
    });

    it('falls back to email when displayName is null', async () => {
      const saved = fakeActivity();
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);
      userRepo.findOne.mockResolvedValue({
        id: ACTOR_ID,
        displayName: null,
        email: 'alice@example.com',
      } as User);

      await service.create({ leagueId: LEAGUE_ID, type: LeagueActivityType.MATCH_CONFIRMED, actorId: ACTOR_ID });

      expect(gateway.emitToLeague).toHaveBeenCalledWith(
        LEAGUE_ID,
        'league:activity',
        expect.objectContaining({ actorName: 'alice' }),
      );
    });

    it('emits actorName=null when actorId is absent', async () => {
      const saved = fakeActivity({ actorId: null });
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);

      await service.create({ leagueId: LEAGUE_ID, type: LeagueActivityType.MEMBER_JOINED });

      expect(userRepo.findOne).not.toHaveBeenCalled();
      expect(gateway.emitToLeague).toHaveBeenCalledWith(
        LEAGUE_ID,
        'league:activity',
        expect.objectContaining({ actorName: null }),
      );
    });

    it('WS emit is best-effort: does not throw if gateway returns false', async () => {
      const saved = fakeActivity({ actorId: null });
      repo.create.mockReturnValue(saved);
      repo.save.mockResolvedValue(saved);
      gateway.emitToLeague.mockReturnValue(false);

      await expect(
        service.create({ leagueId: LEAGUE_ID, type: LeagueActivityType.MEMBER_JOINED }),
      ).resolves.toBe(saved);
    });
  });

  // ── list() ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns items in DESC order with actorName resolved', async () => {
      const act = fakeActivity();
      const qb = makeQb([act]);
      repo.createQueryBuilder.mockReturnValue(qb);
      userRepo.find.mockResolvedValue([
        { id: ACTOR_ID, displayName: 'Alice', email: 'alice@example.com' },
      ] as User[]);

      const { items, nextCursor } = await service.list(LEAGUE_ID, { limit: 20 });

      expect(items).toHaveLength(1);
      expect(items[0].actorName).toBe('Alice');
      expect(items[0].createdAt).toBe('2025-06-15T10:00:00.000Z');
      expect(nextCursor).toBeNull();
    });

    it('sets nextCursor when there are more results than limit', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        fakeActivity({ id: `act-${i + 1}`, actorId: null }),
      );
      const qb = makeQb(rows); // returns limit+1 = 3 rows for limit=2
      repo.createQueryBuilder.mockReturnValue(qb);
      userRepo.find.mockResolvedValue([]);

      const { items, nextCursor } = await service.list(LEAGUE_ID, { limit: 2 });

      expect(items).toHaveLength(2);
      expect(nextCursor).toBe(`2025-06-15T10:00:00.000Z|act-2`);
    });

    it('applies cursor filter when cursor option provided', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      userRepo.find.mockResolvedValue([]);

      await service.list(LEAGUE_ID, {
        cursor: '2025-06-15T10:00:00.000Z|act-5',
        limit: 10,
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        '(a."createdAt", a.id) < (:cursorDate, :cursorId)',
        expect.objectContaining({ cursorId: 'act-5' }),
      );
    });

    it('actorName is null for items with no actorId', async () => {
      const act = fakeActivity({ actorId: null });
      const qb = makeQb([act]);
      repo.createQueryBuilder.mockReturnValue(qb);
      userRepo.find.mockResolvedValue([]);

      const { items } = await service.list(LEAGUE_ID, {});

      expect(items[0].actorName).toBeNull();
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it('caps limit at 100 regardless of input', async () => {
      const qb = makeQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);
      userRepo.find.mockResolvedValue([]);

      await service.list(LEAGUE_ID, { limit: 9999 });

      // take is called with limit+1, max is 100+1=101
      expect(qb.take).toHaveBeenCalledWith(101);
    });
  });

  // ── buildPresentation (via list()) ────────────────────────────────────────

  describe('buildPresentation (title/subtitle) via list()', () => {
    const ACTOR_NAME = 'Alice';

    async function getTitleSubtitle(type: LeagueActivityType, payload: Record<string, unknown> | null = null) {
      const act = fakeActivity({ type, payload: payload as any });
      const qb = makeQb([act]);
      repo.createQueryBuilder.mockReturnValue(qb);
      userRepo.find.mockResolvedValue([{ id: ACTOR_ID, displayName: ACTOR_NAME, email: 'alice@x.com' }] as User[]);
      const { items } = await service.list(LEAGUE_ID, {});
      return { title: items[0].title, subtitle: items[0].subtitle };
    }

    it('MATCH_REPORTED: title is "Se reportó un partido"', async () => {
      const { title, subtitle } = await getTitleSubtitle(LeagueActivityType.MATCH_REPORTED);
      expect(title).toBe('Se reportó un partido');
      expect(subtitle).toContain(ACTOR_NAME);
    });

    it('MATCH_CONFIRMED: title is "Partido confirmado"', async () => {
      const { title, subtitle } = await getTitleSubtitle(LeagueActivityType.MATCH_CONFIRMED);
      expect(title).toBe('Partido confirmado');
      expect(subtitle).toContain(ACTOR_NAME);
    });

    it('MATCH_DISPUTED: title is "Partido en disputa"', async () => {
      const { title, subtitle } = await getTitleSubtitle(LeagueActivityType.MATCH_DISPUTED);
      expect(title).toBe('Partido en disputa');
      expect(subtitle).toContain(ACTOR_NAME);
    });

    it('MATCH_RESOLVED: title is "Disputa resuelta"', async () => {
      const { title, subtitle } = await getTitleSubtitle(LeagueActivityType.MATCH_RESOLVED);
      expect(title).toBe('Disputa resuelta');
      expect(subtitle).toContain(ACTOR_NAME);
    });

    it('MEMBER_JOINED: title is "Nuevo miembro"', async () => {
      const { title, subtitle } = await getTitleSubtitle(LeagueActivityType.MEMBER_JOINED);
      expect(title).toBe('Nuevo miembro');
      expect(subtitle).toContain(ACTOR_NAME);
    });

    it('RANKINGS_UPDATED: title is "Ranking actualizado" and subtitle is non-null', async () => {
      const payload = { topMovers: { up: [{ userId: 'u1', delta: 2, newPosition: 1 }], down: [] } };
      const { title, subtitle } = await getTitleSubtitle(LeagueActivityType.RANKINGS_UPDATED, payload);
      expect(title).toBe('Ranking actualizado');
      expect(subtitle).toBeTruthy();
    });
  });
});
