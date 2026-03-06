import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { createMockRepo } from '@/test-utils/mock-repo';
import { MatchEndorsementsService } from './match-endorsements.service';
import { MatchEndorsement } from '../entities/match-endorsement.entity';
import { MatchResult, MatchResultStatus } from '@core/matches/entities/match-result.entity';
import { MatchType } from '@core/matches/enums/match-type.enum';
import { User } from '@core/users/entities/user.entity';
import { PlayerStrength } from '../enums/player-strength.enum';

const USER_A1 = 'a1111111-1111-4111-a111-111111111111';
const USER_A2 = 'a2222222-2222-4222-a222-222222222222';
const USER_B1 = 'b1111111-1111-4111-b111-111111111111';
const USER_B2 = 'b2222222-2222-4222-b222-222222222222';

function makeConfirmedMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    id: 'match-1',
    challengeId: 'challenge-1',
    status: MatchResultStatus.CONFIRMED,
    matchType: MatchType.COMPETITIVE,
    impactRanking: true,
    updatedAt: new Date(),
    createdAt: new Date(),
    challenge: {
      id: 'challenge-1',
      teamA1Id: USER_A1,
      teamA2Id: USER_A2,
      teamB1Id: USER_B1,
      teamB2Id: USER_B2,
    } as any,
    ...overrides,
  } as MatchResult;
}

describe('MatchEndorsementsService', () => {
  let service: MatchEndorsementsService;

  const endorsementsRepo = createMockRepo<MatchEndorsement>();
  const matchRepo = createMockRepo<MatchResult>();
  const userRepo = createMockRepo<User>();
  const txMatchRepo = createMockRepo<MatchResult>();
  const txEndorsementsRepo = createMockRepo<MatchEndorsement>();
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    dataSource.transaction.mockImplementation(async (cb: any) => {
      const manager = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MatchResult) return txMatchRepo;
          if (entity === MatchEndorsement) return txEndorsementsRepo;
          return createMockRepo();
        }),
      };
      return cb(manager);
    });

    txEndorsementsRepo.create.mockImplementation((value: any) => value);
    txEndorsementsRepo.save.mockImplementation(async (value: any) => ({
      id: 'endorsement-1',
      createdAt: new Date('2026-03-06T10:00:00.000Z'),
      ...value,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchEndorsementsService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(MatchEndorsement),
          useValue: endorsementsRepo,
        },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(MatchEndorsementsService);
  });

  function mockMatchLookup(match: MatchResult) {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(match),
    };
    txMatchRepo.createQueryBuilder.mockReturnValue(qb as any);
  }

  it('creates a valid endorsement for a rival participant', async () => {
    mockMatchLookup(makeConfirmedMatch());

    const result = await service.create('match-1', USER_A1, {
      toUserId: USER_B1,
      strengths: [PlayerStrength.TACTICA, PlayerStrength.DEFENSA],
    });

    expect(result).toEqual({
      id: 'endorsement-1',
      matchId: 'match-1',
      fromUserId: USER_A1,
      toUserId: USER_B1,
      strengths: [PlayerStrength.DEFENSA, PlayerStrength.TACTICA],
      createdAt: '2026-03-06T10:00:00.000Z',
    });
  });

  it('does not allow self endorsement', async () => {
    mockMatchLookup(makeConfirmedMatch());

    await expect(
      service.create('match-1', USER_A1, {
        toUserId: USER_A1,
        strengths: [PlayerStrength.TACTICA],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not allow endorsing a teammate', async () => {
    mockMatchLookup(makeConfirmedMatch());

    await expect(
      service.create('match-1', USER_A1, {
        toUserId: USER_A2,
        strengths: [PlayerStrength.TACTICA],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not allow more than 2 strengths', async () => {
    await expect(
      service.create('match-1', USER_A1, {
        toUserId: USER_B1,
        strengths: [
          PlayerStrength.TACTICA,
          PlayerStrength.DEFENSA,
          PlayerStrength.PRECISION,
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not allow endorsements on non-confirmed matches', async () => {
    mockMatchLookup(
      makeConfirmedMatch({
        status: MatchResultStatus.PENDING_CONFIRM,
      }),
    );

    await expect(
      service.create('match-1', USER_A1, {
        toUserId: USER_B1,
        strengths: [PlayerStrength.TACTICA],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns duplicate conflict for the same rival in the same match', async () => {
    mockMatchLookup(makeConfirmedMatch());
    txEndorsementsRepo.save.mockRejectedValue(
      new QueryFailedError('INSERT', [], {
        code: '23505',
        constraint: 'UQ_match_endorsements_match_from_to',
      } as any),
    );

    await expect(
      service.create('match-1', USER_A1, {
        toUserId: USER_B1,
        strengths: [PlayerStrength.TACTICA],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ENDORSE_DUPLICATE',
      }),
    });
  });

  it('keeps the other rival pending when one doubles rival was already endorsed', async () => {
    const matchQb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          matchId: 'match-1',
          confirmedAt: '2026-03-06T10:00:00.000Z',
          teamA1Id: USER_A1,
          teamA2Id: USER_A2,
          teamB1Id: USER_B1,
          teamB2Id: USER_B2,
        },
      ]),
    };
    matchRepo.createQueryBuilder.mockReturnValue(matchQb as any);

    const endorsementsQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { matchId: 'match-1', toUserId: USER_B1 },
      ]),
    };
    endorsementsRepo.createQueryBuilder.mockReturnValue(endorsementsQb as any);
    userRepo.find.mockResolvedValue([
      { id: USER_B1, displayName: 'Rival 1', email: null },
      { id: USER_B2, displayName: 'Rival 2', email: null },
    ] as User[]);

    const result = await service.getPendingEndorsements(USER_A1, 20);

    expect(result).toEqual({
      items: [
        {
          matchId: 'match-1',
          confirmationAt: '2026-03-06T10:00:00.000Z',
          rivals: [{ userId: USER_B2, displayName: 'Rival 2' }],
        },
      ],
    });
  });

  it('aggregates strengths from endorsements for GET /players/:id/strengths', async () => {
    dataSource.query.mockResolvedValue([
      { strength: PlayerStrength.TACTICA, count: 5 },
      { strength: PlayerStrength.DEFENSA, count: 3 },
    ]);

    const result = await service.getStrengthSummary(USER_B1, 90);

    expect(result).toEqual({
      userId: USER_B1,
      days: 90,
      totalVotes: 8,
      strengths: [
        { strength: PlayerStrength.TACTICA, count: 5, percent: 63 },
        { strength: PlayerStrength.DEFENSA, count: 3, percent: 38 },
      ],
    });
  });
});
