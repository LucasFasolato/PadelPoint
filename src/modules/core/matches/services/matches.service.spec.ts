import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchResult, MatchResultStatus, WinnerTeam } from '../entities/match-result.entity';
import { MatchDispute } from '../entities/match-dispute.entity';
import { MatchAuditLog } from '../entities/match-audit-log.entity';
import { Challenge } from '../../challenges/entities/challenge.entity';
import { User } from '../../users/entities/user.entity';
import { EloService } from '../../competitive/services/elo.service';
import { LeagueStandingsService } from '../../leagues/services/league-standings.service';
import { LeagueActivityService } from '../../leagues/services/league-activity.service';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';
import { UserNotificationType } from '@/modules/core/notifications/enums/user-notification-type.enum';
import { ChallengeStatus } from '../../challenges/enums/challenge-status.enum';
import { DisputeReasonCode } from '../enums/dispute-reason.enum';
import { DisputeStatus } from '../enums/dispute-status.enum';
import { DisputeResolution } from '../dto/resolve-dispute.dto';
import { MatchAuditAction } from '../enums/match-audit-action.enum';
import { MatchType } from '../enums/match-type.enum';
import {
  Reservation,
  ReservationStatus,
} from '@legacy/reservations/reservation.entity';
import { League } from '../../leagues/entities/league.entity';
import { LeagueMember } from '../../leagues/entities/league-member.entity';
import { LeagueStatus } from '../../leagues/enums/league-status.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import {
  createMockDataSource,
  MockDataSource,
} from '@/test-utils/mock-datasource';

const USER_A1 = 'a1111111-1111-4111-a111-111111111111';
const USER_A2 = 'a2222222-2222-4222-a222-222222222222';
const USER_B1 = 'b1111111-1111-4111-b111-111111111111';
const USER_B2 = 'b2222222-2222-4222-b222-222222222222';
const OUTSIDER = 'c3333333-3333-4333-c333-333333333333';
const ADMIN = 'd4444444-4444-4444-d444-444444444444';

function fakeChallenge(): Challenge {
  return {
    id: 'challenge-1',
    matchType: MatchType.COMPETITIVE,
    teamA1Id: USER_A1,
    teamA2Id: USER_A2,
    teamB1Id: USER_B1,
    teamB2Id: USER_B2,
  } as Challenge;
}

function fakeMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    id: 'match-1',
    challengeId: 'challenge-1',
    status: MatchResultStatus.CONFIRMED,
    reportedByUserId: USER_A1,
    confirmedByUserId: USER_B1,
    matchType: MatchType.COMPETITIVE,
    impactRanking: true,
    eloApplied: true,
    playedAt: new Date('2025-06-15T10:00:00Z'),
    updatedAt: new Date(), // recently confirmed
    createdAt: new Date(),
    ...overrides,
  } as MatchResult;
}

function fakeDispute(overrides: Partial<MatchDispute> = {}): MatchDispute {
  return {
    id: 'dispute-1',
    matchId: 'match-1',
    raisedByUserId: USER_B1,
    reasonCode: DisputeReasonCode.WRONG_SCORE,
    message: null,
    status: DisputeStatus.OPEN,
    createdAt: new Date(),
    resolvedAt: null,
    ...overrides,
  } as MatchDispute;
}

describe('MatchesService', () => {
  let service: MatchesService;
  let dataSource: MockDataSource;
  let matchRepo: MockRepo<MatchResult>;
  let challengeRepo: MockRepo<Challenge>;
  let disputeRepo: MockRepo<MatchDispute>;
  let auditRepo: MockRepo<MatchAuditLog>;
  let userRepo: MockRepo<User>;
  let reservationRepo: MockRepo<Reservation>;
  let userNotifications: { create: jest.Mock };
  let leagueStandingsService: { recomputeForMatch: jest.Mock };
  let leagueActivityService: { create: jest.Mock };

  // Mock repos returned inside transactions
  let txMatchRepo: MockRepo<MatchResult>;
  let txDisputeRepo: MockRepo<MatchDispute>;
  let txAuditRepo: MockRepo<MatchAuditLog>;
  let txChallengeRepo: MockRepo<Challenge>;
  let txLeagueRepo: MockRepo<League>;
  let txMemberRepo: MockRepo<LeagueMember>;
  let txReservationRepo: MockRepo<Reservation>;

  beforeEach(async () => {
    dataSource = createMockDataSource();
    matchRepo = createMockRepo<MatchResult>();
    challengeRepo = createMockRepo<Challenge>();
    disputeRepo = createMockRepo<MatchDispute>();
    auditRepo = createMockRepo<MatchAuditLog>();
    userRepo = createMockRepo<User>();
    reservationRepo = createMockRepo<Reservation>();
    userNotifications = { create: jest.fn().mockResolvedValue({}) };
    leagueStandingsService = { recomputeForMatch: jest.fn() };
    leagueActivityService = { create: jest.fn().mockResolvedValue({}) };

    // Transaction mock repos
    txMatchRepo = createMockRepo<MatchResult>();
    txDisputeRepo = createMockRepo<MatchDispute>();
    txAuditRepo = createMockRepo<MatchAuditLog>();
    txChallengeRepo = createMockRepo<Challenge>();
    txLeagueRepo = createMockRepo<League>();
    txMemberRepo = createMockRepo<LeagueMember>();
    txReservationRepo = createMockRepo<Reservation>();

    // Default: transaction executes callback with a mock manager
    dataSource.transaction.mockImplementation(async (cb: any) => {
      const manager = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MatchResult) return txMatchRepo;
          if (entity === MatchDispute) return txDisputeRepo;
          if (entity === MatchAuditLog) return txAuditRepo;
          if (entity === Challenge) return txChallengeRepo;
          if (entity === League) return txLeagueRepo;
          if (entity === LeagueMember) return txMemberRepo;
          if (entity === Reservation) return txReservationRepo;
          if (entity === User) return userRepo;
          return createMockRepo();
        }),
        save: jest.fn().mockImplementation(async (entity: any) => entity),
      };
      return cb(manager);
    });

    // Default user lookup
    userRepo.findOne.mockResolvedValue({
      id: USER_B1,
      displayName: 'Player B1',
    });
    userRepo.find.mockResolvedValue([
      { id: USER_A1, cityId: 'city-1' },
      { id: USER_A2, cityId: 'city-1' },
      { id: USER_B1, cityId: 'city-1' },
      { id: USER_B2, cityId: 'city-1' },
    ] as User[]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(MatchDispute), useValue: disputeRepo },
        { provide: getRepositoryToken(MatchAuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
        { provide: EloService, useValue: { applyForMatchTx: jest.fn() } },
        { provide: LeagueStandingsService, useValue: leagueStandingsService },
        { provide: LeagueActivityService, useValue: leagueActivityService },
        { provide: UserNotificationsService, useValue: userNotifications },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(48) },
        },
      ],
    }).compile();

    service = module.get<MatchesService>(MatchesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── disputeMatch ────────────────────────────────────────────────

  describe('disputeMatch', () => {
    it('should dispute a confirmed match', async () => {
      const match = fakeMatch();
      const challenge = fakeChallenge();
      const dispute = fakeDispute();

      // Transaction repos
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txChallengeRepo.findOne.mockResolvedValue(challenge);
      txDisputeRepo.findOne.mockResolvedValue(null); // no existing dispute
      txDisputeRepo.create.mockReturnValue(dispute);
      txDisputeRepo.save.mockResolvedValue(dispute);
      txMatchRepo.save.mockResolvedValue({
        ...match,
        status: MatchResultStatus.DISPUTED,
      });
      txAuditRepo.create.mockReturnValue({ id: 'audit-1' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-1' });

      const result = await service.disputeMatch(USER_B1, 'match-1', {
        reasonCode: DisputeReasonCode.WRONG_SCORE,
      });

      expect(result.dispute.status).toBe(DisputeStatus.OPEN);
      expect(result.matchStatus).toBe(MatchResultStatus.DISPUTED);

      // Verify audit log created
      expect(txAuditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          matchId: 'match-1',
          actorUserId: USER_B1,
          action: MatchAuditAction.DISPUTE_RAISED,
        }),
      );
    });

    it('should throw MATCH_NOT_FOUND for nonexistent match', async () => {
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      try {
        await service.disputeMatch(USER_B1, 'bad-id', {
          reasonCode: DisputeReasonCode.WRONG_SCORE,
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.response.code).toBe('MATCH_NOT_FOUND');
      }
    });

    it('should throw MATCH_NOT_CONFIRMED for non-confirmed match', async () => {
      const match = fakeMatch({ status: MatchResultStatus.PENDING_CONFIRM });
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });

      try {
        await service.disputeMatch(USER_B1, 'match-1', {
          reasonCode: DisputeReasonCode.WRONG_SCORE,
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('MATCH_NOT_CONFIRMED');
      }
    });

    it('should throw MATCH_FORBIDDEN if not a participant', async () => {
      const match = fakeMatch();
      const challenge = fakeChallenge();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txChallengeRepo.findOne.mockResolvedValue(challenge);

      try {
        await service.disputeMatch(OUTSIDER, 'match-1', {
          reasonCode: DisputeReasonCode.WRONG_SCORE,
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('MATCH_FORBIDDEN');
      }
    });

    it('should throw DISPUTE_ALREADY_OPEN if dispute exists', async () => {
      const match = fakeMatch();
      const challenge = fakeChallenge();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txChallengeRepo.findOne.mockResolvedValue(challenge);
      txDisputeRepo.findOne.mockResolvedValue(fakeDispute()); // existing dispute

      try {
        await service.disputeMatch(USER_B1, 'match-1', {
          reasonCode: DisputeReasonCode.WRONG_SCORE,
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response.code).toBe('DISPUTE_ALREADY_OPEN');
      }
    });

    it('should throw DISPUTE_WINDOW_EXPIRED after window elapses', async () => {
      const oldDate = new Date(Date.now() - 49 * 60 * 60 * 1000); // 49h ago
      const match = fakeMatch({ updatedAt: oldDate });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });

      try {
        await service.disputeMatch(USER_B1, 'match-1', {
          reasonCode: DisputeReasonCode.WRONG_SCORE,
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('DISPUTE_WINDOW_EXPIRED');
      }
    });

    it('should send MATCH_DISPUTED notifications to other participants', async () => {
      const match = fakeMatch();
      const challenge = fakeChallenge();
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txChallengeRepo.findOne.mockResolvedValue(challenge);
      txDisputeRepo.findOne.mockResolvedValue(null);
      txDisputeRepo.create.mockReturnValue(dispute);
      txDisputeRepo.save.mockResolvedValue(dispute);
      txMatchRepo.save.mockResolvedValue({
        ...match,
        status: MatchResultStatus.DISPUTED,
      });
      txAuditRepo.create.mockReturnValue({ id: 'audit-1' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-1' });

      // Also mock challengeRepo for the notifyDispute helper (uses the non-tx repo)
      challengeRepo.findOne.mockResolvedValue(challenge);

      await service.disputeMatch(USER_B1, 'match-1', {
        reasonCode: DisputeReasonCode.WRONG_SCORE,
      });

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 20));

      // Should notify 3 other participants (not the raiser)
      expect(userNotifications.create).toHaveBeenCalledTimes(3);

      // All should be MATCH_DISPUTED
      for (const call of userNotifications.create.mock.calls) {
        expect(call[0].type).toBe(UserNotificationType.MATCH_DISPUTED);
        expect(call[0].data.matchId).toBe('match-1');
        expect(call[0].data.link).toBe('/matches/match-1');
      }

      // Raiser should NOT be notified
      const notifiedUserIds = userNotifications.create.mock.calls.map(
        (c: any) => c[0].userId,
      );
      expect(notifiedUserIds).not.toContain(USER_B1);
      expect(notifiedUserIds).toContain(USER_A1);
      expect(notifiedUserIds).toContain(USER_A2);
      expect(notifiedUserIds).toContain(USER_B2);
    });
  });

  // ── resolveDispute ──────────────────────────────────────────────

  describe('resolveDispute', () => {
    it('should resolve a dispute with CONFIRM_AS_IS', async () => {
      const match = fakeMatch({ status: MatchResultStatus.DISPUTED });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({
        ...dispute,
        status: DisputeStatus.RESOLVED,
        resolvedAt: new Date(),
      });
      txMatchRepo.save.mockResolvedValue({
        ...match,
        status: MatchResultStatus.CONFIRMED,
      });
      txAuditRepo.create.mockReturnValue({ id: 'audit-2' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-2' });

      const result = await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.CONFIRM_AS_IS,
      });

      expect(result.matchStatus).toBe(MatchResultStatus.CONFIRMED);
      expect(result.resolution).toBe(DisputeResolution.CONFIRM_AS_IS);

      expect(txAuditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          matchId: 'match-1',
          actorUserId: ADMIN,
          action: MatchAuditAction.DISPUTE_RESOLVED,
          payload: expect.objectContaining({
            resolution: DisputeResolution.CONFIRM_AS_IS,
          }),
        }),
      );
    });

    it('should resolve a dispute with VOID_MATCH', async () => {
      const match = fakeMatch({ status: MatchResultStatus.DISPUTED });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({
        ...dispute,
        status: DisputeStatus.RESOLVED,
        resolvedAt: new Date(),
      });
      txMatchRepo.save.mockResolvedValue({
        ...match,
        status: MatchResultStatus.RESOLVED,
      });
      txAuditRepo.create.mockReturnValue({ id: 'audit-3' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-3' });

      const result = await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.VOID_MATCH,
        note: 'Evidence shows match was not played',
      });

      expect(result.matchStatus).toBe(MatchResultStatus.RESOLVED);
      expect(result.resolution).toBe(DisputeResolution.VOID_MATCH);
    });

    it('should throw MATCH_NOT_FOUND when no open dispute exists', async () => {
      const match = fakeMatch({ status: MatchResultStatus.DISPUTED });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(null); // no open dispute

      try {
        await service.resolveDispute(ADMIN, 'match-1', {
          resolution: DisputeResolution.CONFIRM_AS_IS,
        });
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });

    it('should send MATCH_RESOLVED notifications to all participants', async () => {
      const match = fakeMatch({ status: MatchResultStatus.DISPUTED });
      const dispute = fakeDispute();
      const challenge = fakeChallenge();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({
        ...dispute,
        status: DisputeStatus.RESOLVED,
        resolvedAt: new Date(),
      });
      txMatchRepo.save.mockResolvedValue({
        ...match,
        status: MatchResultStatus.CONFIRMED,
      });
      txAuditRepo.create.mockReturnValue({ id: 'audit-4' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-4' });

      // Mock for notifyResolution helper (uses non-tx challengeRepo)
      challengeRepo.findOne.mockResolvedValue(challenge);

      await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.CONFIRM_AS_IS,
      });

      await new Promise((r) => setTimeout(r, 20));

      // All 4 participants should receive MATCH_RESOLVED
      expect(userNotifications.create).toHaveBeenCalledTimes(4);
      for (const call of userNotifications.create.mock.calls) {
        expect(call[0].type).toBe(UserNotificationType.MATCH_RESOLVED);
        expect(call[0].data.link).toBe('/matches/match-1');
        expect(call[0].data.resolution).toBe(DisputeResolution.CONFIRM_AS_IS);
      }
    });

    it('should call recomputeForMatch on CONFIRM_AS_IS', async () => {
      const match = fakeMatch({
        status: MatchResultStatus.DISPUTED,
        leagueId: 'league-1',
      });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({
        ...dispute,
        status: DisputeStatus.RESOLVED,
      });
      txMatchRepo.save.mockResolvedValue({
        ...match,
        status: MatchResultStatus.CONFIRMED,
      });
      txAuditRepo.create.mockReturnValue({ id: 'audit-5' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-5' });
      challengeRepo.findOne.mockResolvedValue(fakeChallenge());

      await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.CONFIRM_AS_IS,
      });

      expect(leagueStandingsService.recomputeForMatch).toHaveBeenCalledWith(
        expect.anything(),
        'match-1',
      );
    });

    it('should call recomputeForMatch on VOID_MATCH to exclude voided match from standings', async () => {
      const match = fakeMatch({
        status: MatchResultStatus.DISPUTED,
        leagueId: 'league-1',
      });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({
        ...dispute,
        status: DisputeStatus.RESOLVED,
      });
      txMatchRepo.save.mockResolvedValue({
        ...match,
        status: MatchResultStatus.RESOLVED,
      });
      txAuditRepo.create.mockReturnValue({ id: 'audit-6' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-6' });
      challengeRepo.findOne.mockResolvedValue(fakeChallenge());

      await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.VOID_MATCH,
      });

      // Fix: recomputeForMatch must be called to remove the voided match from standings
      expect(leagueStandingsService.recomputeForMatch).toHaveBeenCalledWith(
        expect.any(Object),
        'match-1',
      );
    });
  });

  // ── reportFromReservation ────────────────────────────────────────

  describe('reportFromReservation', () => {
    const LEAGUE_ID = 'league-1';
    const RESERVATION_ID = 'reservation-1';

    const validDto = {
      reservationId: RESERVATION_ID,
      teamA1Id: USER_A1,
      teamA2Id: USER_A2,
      teamB1Id: USER_B1,
      teamB2Id: USER_B2,
      sets: [
        { a: 6, b: 3 },
        { a: 6, b: 4 },
      ],
    };

    function setupHappyPath() {
      txLeagueRepo.findOne.mockResolvedValue({
        id: LEAGUE_ID,
        status: LeagueStatus.ACTIVE,
      });
      txMemberRepo.findOne.mockResolvedValue({
        userId: USER_A1,
        leagueId: LEAGUE_ID,
      });
      txReservationRepo.findOne.mockResolvedValue({
        id: RESERVATION_ID,
        status: ReservationStatus.CONFIRMED,
        startAt: new Date(Date.now() - 3600_000), // 1h ago
      });
      txMemberRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(4),
      });
      txMatchRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });
      txChallengeRepo.create.mockImplementation((v: any) => ({
        id: 'ch-new',
        ...v,
      }));
      txChallengeRepo.save.mockImplementation(async (v: any) => v);
      txMatchRepo.create.mockImplementation((v: any) => ({
        id: 'match-new',
        ...v,
      }));
      txMatchRepo.save.mockImplementation(async (v: any) => v);
    }

    it('should create a match from a valid reservation', async () => {
      setupHappyPath();

      const result = await service.reportFromReservation(
        USER_A1,
        LEAGUE_ID,
        validDto,
      );

      expect(result.id).toBe('match-new');
      expect(result.leagueId).toBe(LEAGUE_ID);
      expect(result.status).toBe(MatchResultStatus.PENDING_CONFIRM);
      expect(txChallengeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ reservationId: RESERVATION_ID }),
      );
    });

    it('should throw LEAGUE_ID_REQUIRED when leagueId is missing', async () => {
      await expect(
        service.reportFromReservation(USER_A1, '' as any, validDto),
      ).rejects.toMatchObject({
        response: { code: 'LEAGUE_ID_REQUIRED' },
      });
    });

    it('should throw LEAGUE_FORBIDDEN if caller is not a member', async () => {
      txLeagueRepo.findOne.mockResolvedValue({
        id: LEAGUE_ID,
        status: LeagueStatus.ACTIVE,
      });
      txMemberRepo.findOne.mockResolvedValue(null);

      try {
        await service.reportFromReservation(OUTSIDER, LEAGUE_ID, validDto);
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('LEAGUE_FORBIDDEN');
      }
    });

    it('should throw RESERVATION_NOT_ELIGIBLE for unconfirmed reservation', async () => {
      txLeagueRepo.findOne.mockResolvedValue({
        id: LEAGUE_ID,
        status: LeagueStatus.ACTIVE,
      });
      txMemberRepo.findOne.mockResolvedValue({ userId: USER_A1 });
      txReservationRepo.findOne.mockResolvedValue({
        id: RESERVATION_ID,
        status: ReservationStatus.HOLD,
        startAt: new Date(Date.now() - 3600_000),
      });

      try {
        await service.reportFromReservation(USER_A1, LEAGUE_ID, validDto);
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('RESERVATION_NOT_ELIGIBLE');
      }
    });

    it('should throw RESERVATION_NOT_ELIGIBLE for future reservation', async () => {
      txLeagueRepo.findOne.mockResolvedValue({
        id: LEAGUE_ID,
        status: LeagueStatus.ACTIVE,
      });
      txMemberRepo.findOne.mockResolvedValue({ userId: USER_A1 });
      txReservationRepo.findOne.mockResolvedValue({
        id: RESERVATION_ID,
        status: ReservationStatus.CONFIRMED,
        startAt: new Date(Date.now() + 3600_000), // 1h in the future
      });

      try {
        await service.reportFromReservation(USER_A1, LEAGUE_ID, validDto);
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect(e.response.code).toBe('RESERVATION_NOT_ELIGIBLE');
      }
    });

    it('should throw MATCH_ALREADY_REPORTED for duplicate', async () => {
      txLeagueRepo.findOne.mockResolvedValue({
        id: LEAGUE_ID,
        status: LeagueStatus.ACTIVE,
      });
      txMemberRepo.findOne.mockResolvedValue({ userId: USER_A1 });
      txReservationRepo.findOne.mockResolvedValue({
        id: RESERVATION_ID,
        status: ReservationStatus.CONFIRMED,
        startAt: new Date(Date.now() - 3600_000),
      });
      txMemberRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(4),
      });
      txMatchRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-match' }),
      });

      try {
        await service.reportFromReservation(USER_A1, LEAGUE_ID, validDto);
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response.code).toBe('MATCH_ALREADY_REPORTED');
      }
    });

    it('should NOT call recomputeForMatch on report', async () => {
      setupHappyPath();

      await service.reportFromReservation(USER_A1, LEAGUE_ID, validDto);

      expect(leagueStandingsService.recomputeForMatch).not.toHaveBeenCalled();
    });
  });

  describe('reportManual', () => {
    it('should throw LEAGUE_ID_REQUIRED when leagueId is missing', async () => {
      await expect(
        service.reportManual(USER_A1, '' as any, {
          teamA1Id: USER_A1,
          teamA2Id: USER_A2,
          teamB1Id: USER_B1,
          teamB2Id: USER_B2,
          sets: [
            { a: 6, b: 4 },
            { a: 6, b: 2 },
          ],
        }),
      ).rejects.toMatchObject({
        response: { code: 'LEAGUE_ID_REQUIRED' },
      });
    });
  });

  // ── getEligibleReservations ───────────────────────────────────────

  describe('getEligibleReservations', () => {
    const LEAGUE_ID = 'league-1';

    it('should throw LEAGUE_FORBIDDEN if caller is not a member', async () => {
      const dsLeagueRepo = createMockRepo<League>();
      const dsMemberRepo = createMockRepo<LeagueMember>();
      dsLeagueRepo.findOne.mockResolvedValue({ id: LEAGUE_ID });
      dsMemberRepo.find.mockResolvedValue([]); // no members

      dataSource.getRepository = jest.fn().mockImplementation((entity: any) => {
        if (entity === League) return dsLeagueRepo;
        if (entity === LeagueMember) return dsMemberRepo;
        return createMockRepo();
      });

      try {
        await service.getEligibleReservations(OUTSIDER, LEAGUE_ID);
        fail('should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(e.response.code).toBe('LEAGUE_FORBIDDEN');
      }
    });

    it('should return empty array when no reservations match', async () => {
      const dsLeagueRepo = createMockRepo<League>();
      const dsMemberRepo = createMockRepo<LeagueMember>();
      dsLeagueRepo.findOne.mockResolvedValue({ id: LEAGUE_ID });
      dsMemberRepo.find.mockResolvedValue([
        { userId: USER_A1, leagueId: LEAGUE_ID },
      ]);
      userRepo.find.mockResolvedValue([
        { id: USER_A1, email: 'a1@test.com', displayName: 'Player A1' },
      ]);

      const dsResRepo = createMockRepo<Reservation>();
      dsResRepo.createQueryBuilder.mockReturnValue({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      dataSource.getRepository = jest.fn().mockImplementation((entity: any) => {
        if (entity === League) return dsLeagueRepo;
        if (entity === LeagueMember) return dsMemberRepo;
        if (entity === Reservation) return dsResRepo;
        return createMockRepo();
      });

      const result = await service.getEligibleReservations(USER_A1, LEAGUE_ID);
      expect(result).toEqual([]);
    });
  });

  // ── Competitive pipeline tests ──────────────────────────────────
  // These tests cover the full match lifecycle and verify all
  // side-effects (ELO, standings, notifications) are triggered correctly.

  describe('competitive pipeline', () => {
    const LEAGUE_ID = 'league-pipeline-1';
    let eloService: { applyForMatchTx: jest.Mock };

    beforeEach(async () => {
      eloService = { applyForMatchTx: jest.fn().mockResolvedValue({ ok: true }) };
      leagueStandingsService = { recomputeForMatch: jest.fn().mockResolvedValue(undefined) };
      userNotifications = { create: jest.fn().mockResolvedValue({}) };
      leagueActivityService = { create: jest.fn().mockResolvedValue({}) };

      dataSource.transaction.mockImplementation(async (cb: any) => {
        const manager = {
          getRepository: jest.fn().mockImplementation((entity: any) => {
            if (entity === MatchResult) return txMatchRepo;
            if (entity === MatchDispute) return txDisputeRepo;
            if (entity === MatchAuditLog) return txAuditRepo;
            if (entity === Challenge) return txChallengeRepo;
            if (entity === League) return txLeagueRepo;
            if (entity === LeagueMember) return txMemberRepo;
            if (entity === Reservation) return txReservationRepo;
            if (entity === User) return userRepo;
            return createMockRepo();
          }),
          save: jest.fn().mockImplementation(async (entity: any) => entity),
        };
        return cb(manager);
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MatchesService,
          { provide: DataSource, useValue: dataSource },
          { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
          { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
          { provide: getRepositoryToken(MatchDispute), useValue: disputeRepo },
          { provide: getRepositoryToken(MatchAuditLog), useValue: auditRepo },
          { provide: getRepositoryToken(User), useValue: userRepo },
          { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
          { provide: EloService, useValue: eloService },
          { provide: LeagueStandingsService, useValue: leagueStandingsService },
          { provide: LeagueActivityService, useValue: leagueActivityService },
          { provide: UserNotificationsService, useValue: userNotifications },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(48) },
          },
        ],
      }).compile();

      service = module.get<MatchesService>(MatchesService);
    });

    // Test 1: report match → PENDING_CONFIRM
    it('should report match and return PENDING_CONFIRM status', async () => {
      const match = fakeMatch({ status: MatchResultStatus.PENDING_CONFIRM, eloApplied: false });
      const readyChallenge = { ...fakeChallenge(), status: ChallengeStatus.READY, reservationId: null };

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null), // no existing match
      });
      txChallengeRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(readyChallenge),
      });
      txMatchRepo.create.mockReturnValue(match);
      txMatchRepo.save.mockResolvedValue(match);

      const result = await service.reportMatch(USER_A1, {
        challengeId: 'challenge-1',
        sets: [{ a: 6, b: 3 }, { a: 6, b: 4 }],
      });

      expect(result.status).toBe(MatchResultStatus.PENDING_CONFIRM);
      expect(eloService.applyForMatchTx).not.toHaveBeenCalled();
      expect(leagueStandingsService.recomputeForMatch).not.toHaveBeenCalled();
    });

    it('should update existing scheduled draft (league-scoped) instead of throwing duplicate', async () => {
      const readyChallenge = {
        ...fakeChallenge(),
        status: ChallengeStatus.READY,
        reservationId: null,
      };
      const scheduledDraft = fakeMatch({
        id: 'match-draft-1',
        challengeId: 'challenge-1',
        leagueId: LEAGUE_ID,
        status: MatchResultStatus.SCHEDULED,
        playedAt: null,
        winnerTeam: null,
        confirmedByUserId: null,
      });

      txChallengeRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(readyChallenge),
      });
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(scheduledDraft),
      });
      txLeagueRepo.findOne.mockResolvedValue({
        id: LEAGUE_ID,
        status: LeagueStatus.ACTIVE,
      });
      txMemberRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(4),
      });
      txMatchRepo.save.mockImplementation(async (input: any) => input);

      const result = await service.reportMatch(USER_A1, {
        challengeId: 'challenge-1',
        sets: [
          { a: 6, b: 3 },
          { a: 6, b: 4 },
        ],
      });

      expect(result.id).toBe('match-draft-1');
      expect(result.leagueId).toBe(LEAGUE_ID);
      expect(result.status).toBe(MatchResultStatus.PENDING_CONFIRM);
      expect(result.teamASet1).toBe(6);
      expect(result.teamBSet1).toBe(3);
      expect(txMatchRepo.create).not.toHaveBeenCalled();
    });

    it('should not read leagueId from generic Challenge metadata', async () => {
      const readyChallenge = {
        ...fakeChallenge(),
        status: ChallengeStatus.READY,
        reservationId: null,
      } as Challenge;

      Object.defineProperty(readyChallenge, 'leagueId', {
        configurable: true,
        get: () => {
          throw new Error('challenge.leagueId must not be read');
        },
      });

      txChallengeRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(readyChallenge),
      });
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });
      txMatchRepo.create.mockImplementation((input: any) => ({
        ...fakeMatch({
          id: 'match-non-league-1',
          challengeId: 'challenge-1',
          leagueId: null,
          status: MatchResultStatus.PENDING_CONFIRM,
          reportedByUserId: USER_A1,
          confirmedByUserId: null,
          eloApplied: false,
        }),
        ...input,
      }));
      txMatchRepo.save.mockImplementation(async (input: any) => input);

      const result = await service.reportMatch(USER_A1, {
        challengeId: 'challenge-1',
        sets: [{ a: 6, b: 3 }, { a: 6, b: 4 }],
      });

      expect(txMatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ leagueId: null }),
      );
      expect(result.leagueId).toBeNull();
      expect(result.status).toBe(MatchResultStatus.PENDING_CONFIRM);
    });

    // Test 2: confirm match → ELO applied idempotently (already CONFIRMED)
    it('should apply ELO idempotently when match is already CONFIRMED', async () => {
      const confirmedMatch = fakeMatch({ status: MatchResultStatus.CONFIRMED, eloApplied: true });
      eloService.applyForMatchTx.mockResolvedValue({ ok: true, alreadyApplied: true });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(confirmedMatch),
      });

      await service.confirmMatch(USER_B1, 'match-1');

      // ELO should be called but the service's guard will return alreadyApplied
      expect(eloService.applyForMatchTx).toHaveBeenCalledTimes(1);
    });

    // Test 3: confirm match → standings recompute + snapshot triggered
    it('should trigger standings recompute after confirmMatch', async () => {
      const pendingMatch = fakeMatch({
        status: MatchResultStatus.PENDING_CONFIRM,
        eloApplied: false,
        matchType: MatchType.COMPETITIVE,
        impactRanking: true,
        reportedByUserId: USER_A1,
        leagueId: LEAGUE_ID,
      });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(pendingMatch),
      });
      txChallengeRepo.findOne.mockResolvedValue(fakeChallenge());
      txMatchRepo.save.mockResolvedValue({
        ...pendingMatch,
        status: MatchResultStatus.CONFIRMED,
        confirmedByUserId: USER_B1,
      });
      txMatchRepo.findOne.mockResolvedValue({ ...pendingMatch, status: MatchResultStatus.CONFIRMED });

      await service.confirmMatch(USER_B1, 'match-1');

      expect(eloService.applyForMatchTx).toHaveBeenCalledWith(expect.any(Object), 'match-1');
      expect(leagueStandingsService.recomputeForMatch).toHaveBeenCalledWith(
        expect.any(Object),
        'match-1',
      );
      expect(leagueActivityService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          leagueId: LEAGUE_ID,
          type: 'match_confirmed',
          entityId: 'match-1',
        }),
      );
    });

    it('should NOT apply ELO or recompute standings for FRIENDLY matches on confirmMatch', async () => {
      const pendingFriendlyMatch = fakeMatch({
        status: MatchResultStatus.PENDING_CONFIRM,
        eloApplied: false,
        matchType: MatchType.FRIENDLY,
        impactRanking: false,
        reportedByUserId: USER_A1,
        leagueId: LEAGUE_ID,
      });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(pendingFriendlyMatch),
      });
      txChallengeRepo.findOne.mockResolvedValue({
        ...fakeChallenge(),
        matchType: MatchType.FRIENDLY,
      });
      txMatchRepo.save.mockResolvedValue({
        ...pendingFriendlyMatch,
        status: MatchResultStatus.CONFIRMED,
        confirmedByUserId: USER_B1,
      });
      txMatchRepo.findOne.mockResolvedValue({
        ...pendingFriendlyMatch,
        status: MatchResultStatus.CONFIRMED,
      });

      await service.confirmMatch(USER_B1, 'match-1');

      expect(eloService.applyForMatchTx).not.toHaveBeenCalled();
      expect(leagueStandingsService.recomputeForMatch).not.toHaveBeenCalled();
    });

    // Test 4: notifications are created for each non-confirmer participant
    it('should send match-confirmed notifications to all participants except confirmer', async () => {
      const pendingMatch = fakeMatch({
        status: MatchResultStatus.PENDING_CONFIRM,
        reportedByUserId: USER_A1,
        leagueId: LEAGUE_ID,
      });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(pendingMatch),
      });
      txChallengeRepo.findOne.mockResolvedValue(fakeChallenge());
      txMatchRepo.save.mockResolvedValue({ ...pendingMatch, status: MatchResultStatus.CONFIRMED });
      txMatchRepo.findOne.mockResolvedValue({ ...pendingMatch, status: MatchResultStatus.CONFIRMED });
      userRepo.findOne.mockResolvedValue({ id: USER_B1, displayName: 'Player B1' });

      await service.confirmMatch(USER_B1, 'match-1');

      // Notifications are fire-and-forget; wait a tick
      await new Promise((r) => setTimeout(r, 10));

      // 3 other participants (USER_A1, USER_A2, USER_B2) should be notified
      expect(userNotifications.create).toHaveBeenCalledTimes(3);
      const notifiedUserIds = (userNotifications.create as jest.Mock).mock.calls.map(
        (c) => c[0].userId,
      );
      expect(notifiedUserIds).toContain(USER_A1);
      expect(notifiedUserIds).toContain(USER_A2);
      expect(notifiedUserIds).toContain(USER_B2);
      expect(notifiedUserIds).not.toContain(USER_B1); // confirmer excluded
    });

    // Test 5: dispute window enforcement
    it('should throw DISPUTE_WINDOW_EXPIRED when 48h window has passed', async () => {
      const oldConfirmedMatch = fakeMatch({
        status: MatchResultStatus.CONFIRMED,
        updatedAt: new Date(Date.now() - 49 * 60 * 60 * 1000), // 49h ago
      });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(oldConfirmedMatch),
      });
      txDisputeRepo.findOne.mockResolvedValue(null);
      txChallengeRepo.findOne.mockResolvedValue(fakeChallenge());

      await expect(
        service.disputeMatch(USER_A1, 'match-1', {
          reasonCode: DisputeReasonCode.WRONG_SCORE,
        }),
      ).rejects.toMatchObject({ response: { code: 'DISPUTE_WINDOW_EXPIRED' } });
    });

    // Test 6: dispute within window succeeds and creates audit log
    it('should create dispute within 48h window and log audit entry', async () => {
      const recentMatch = fakeMatch({
        status: MatchResultStatus.CONFIRMED,
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
      });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(recentMatch),
      });
      txDisputeRepo.findOne.mockResolvedValue(null);
      txChallengeRepo.findOne.mockResolvedValue(fakeChallenge());
      txDisputeRepo.create.mockReturnValue(fakeDispute());
      txDisputeRepo.save.mockResolvedValue(fakeDispute());
      txMatchRepo.save.mockResolvedValue({ ...recentMatch, status: MatchResultStatus.DISPUTED });
      txAuditRepo.create.mockReturnValue({ id: 'audit-dispute' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-dispute' });

      const result = await service.disputeMatch(USER_A1, 'match-1', {
        reasonCode: DisputeReasonCode.WRONG_SCORE,
      });

      expect(result.matchStatus).toBe(MatchResultStatus.DISPUTED);
      expect(txAuditRepo.save).toHaveBeenCalledTimes(1);
      const auditArg = (txAuditRepo.create as jest.Mock).mock.calls[0][0];
      expect(auditArg.action).toBe(MatchAuditAction.DISPUTE_RAISED);
    });

    // Test 7: resolveDispute CONFIRM_AS_IS → ELO applied + standings recomputed
    it('should apply ELO and recompute standings on CONFIRM_AS_IS resolution', async () => {
      const disputedMatch = fakeMatch({ status: MatchResultStatus.DISPUTED, leagueId: LEAGUE_ID });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(disputedMatch),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({ ...dispute, status: DisputeStatus.RESOLVED });
      txMatchRepo.save.mockResolvedValue({ ...disputedMatch, status: MatchResultStatus.CONFIRMED });
      txAuditRepo.create.mockReturnValue({ id: 'audit-resolve' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-resolve' });

      await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.CONFIRM_AS_IS,
      });

      expect(leagueStandingsService.recomputeForMatch).toHaveBeenCalledWith(
        expect.any(Object),
        'match-1',
      );
    });

    // Test 8: resolveDispute VOID_MATCH → standings recomputed (voided match excluded)
    it('should recompute standings on VOID_MATCH so voided match is excluded', async () => {
      const disputedMatch = fakeMatch({ status: MatchResultStatus.DISPUTED, leagueId: LEAGUE_ID });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(disputedMatch),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({ ...dispute, status: DisputeStatus.RESOLVED });
      txMatchRepo.save.mockResolvedValue({ ...disputedMatch, status: MatchResultStatus.RESOLVED });
      txAuditRepo.create.mockReturnValue({ id: 'audit-void' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-void' });
      challengeRepo.findOne.mockResolvedValue(fakeChallenge());

      await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.VOID_MATCH,
      });

      expect(leagueStandingsService.recomputeForMatch).toHaveBeenCalledWith(
        expect.any(Object),
        'match-1',
      );
    });
  });

  // ── getPendingConfirmations ────────────────────────────────────────────────

  describe('getPendingConfirmations', () => {
    it('returns empty list when user has no pending confirmations', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      matchRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getPendingConfirmations(OUTSIDER, {});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
      expect(matchRepo.createQueryBuilder).toHaveBeenCalledWith('m');
    });

    it('returns empty list when all PENDING_CONFIRM matches were reported by the caller', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      matchRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getPendingConfirmations(USER_A1, {});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('maps opponentName fallback to Rival when opponent relation is missing', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            matchId: 'match-pending-1',
            challengeId: 'challenge-1',
            leagueId: 'league-1',
            leagueName: 'League One',
            playedAt: '2025-06-10T10:00:00.000Z',
            createdAt: '2025-06-10T09:00:00.000Z',
            teamASet1: 6,
            teamBSet1: 4,
            teamASet2: null,
            teamBSet2: null,
            teamASet3: null,
            teamBSet3: null,
            teamA1Id: USER_A1,
            teamA2Id: null,
            teamB1Id: null,
            teamB2Id: null,
            teamA1DisplayName: 'A1',
            teamA1Email: 'a1@test.com',
            teamA2DisplayName: null,
            teamA2Email: null,
            teamB1DisplayName: null,
            teamB1Email: null,
            teamB2DisplayName: null,
            teamB2Email: null,
          },
        ]),
      };
      matchRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getPendingConfirmations(USER_A1, {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'match-pending-1',
          matchId: 'match-pending-1',
          status: 'PENDING_CONFIRMATION',
          opponentName: 'Rival',
          cta: expect.objectContaining({ primary: 'Confirmar' }),
        }),
      );
    });
  });

  describe('getLeaguePendingConfirmations', () => {
    it('returns empty list when league has no pending confirmations', async () => {
      const dsMemberRepo = createMockRepo<LeagueMember>();
      dsMemberRepo.findOne.mockResolvedValue({
        id: 'm1',
        leagueId: 'league-1',
        userId: USER_B1,
      });
      dataSource.getRepository.mockImplementation((entity: any) => {
        if (entity === LeagueMember) return dsMemberRepo;
        return createMockRepo();
      });

      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      matchRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getLeaguePendingConfirmations(USER_B1, 'league-1', {
        limit: 10,
      });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it('returns only league pending confirmations the caller can confirm', async () => {
      const dsMemberRepo = createMockRepo<LeagueMember>();
      dsMemberRepo.findOne.mockResolvedValue({
        id: 'm1',
        leagueId: 'league-1',
        userId: USER_B1,
      });
      dataSource.getRepository.mockImplementation((entity: any) => {
        if (entity === LeagueMember) return dsMemberRepo;
        return createMockRepo();
      });

      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            matchId: 'match-pending-1',
            challengeId: 'challenge-1',
            leagueId: 'league-1',
            matchType: MatchType.COMPETITIVE,
            status: MatchResultStatus.PENDING_CONFIRM,
            playedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            winnerTeam: WinnerTeam.A,
            reportedByUserId: USER_A1,
            teamASet1: 6,
            teamBSet1: 4,
            teamASet2: null,
            teamBSet2: null,
            teamASet3: null,
            teamBSet3: null,
            teamA1Id: USER_A1,
            teamA2Id: null,
            teamB1Id: USER_B1,
            teamB2Id: null,
          },
        ]),
      };
      matchRepo.createQueryBuilder.mockReturnValue(qb as any);
      challengeRepo.find.mockResolvedValue([fakeChallenge()]);
      userRepo.find.mockResolvedValue([
        { id: USER_A1, displayName: 'A1', email: 'a1@test.com' } as any,
        { id: USER_A2, displayName: 'A2', email: 'a2@test.com' } as any,
        { id: USER_B1, displayName: 'B1', email: 'b1@test.com' } as any,
        { id: USER_B2, displayName: 'B2', email: 'b2@test.com' } as any,
      ]);

      const result = await service.getLeaguePendingConfirmations(USER_B1, 'league-1', {
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          confirmationId: 'match-pending-1',
          matchId: 'match-pending-1',
          leagueId: 'league-1',
        }),
      );
    });
  });

  describe('league pending confirmations idempotency', () => {
    it('confirmLeaguePendingConfirmation returns CONFIRMED when already confirmed', async () => {
      txMemberRepo.findOne.mockResolvedValue({
        leagueId: 'league-1',
        userId: USER_B1,
      } as LeagueMember);
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(
          fakeMatch({
            id: 'match-1',
            leagueId: 'league-1',
            status: MatchResultStatus.CONFIRMED,
          }),
        ),
      } as any);

      const result = await service.confirmLeaguePendingConfirmation(
        USER_B1,
        'league-1',
        'match-1',
      );

      expect(result).toEqual({
        status: 'CONFIRMED',
        matchId: 'match-1',
      });
      expect(txMatchRepo.save).not.toHaveBeenCalled();
    });

    it('confirmLeaguePendingConfirmation returns REJECTED when already rejected', async () => {
      txMemberRepo.findOne.mockResolvedValue({
        leagueId: 'league-1',
        userId: USER_B1,
      } as LeagueMember);
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(
          fakeMatch({
            id: 'match-1',
            leagueId: 'league-1',
            status: MatchResultStatus.REJECTED,
          }),
        ),
      } as any);

      const result = await service.confirmLeaguePendingConfirmation(
        USER_B1,
        'league-1',
        'match-1',
      );

      expect(result).toEqual({
        status: 'REJECTED',
        matchId: 'match-1',
      });
      expect(txMatchRepo.save).not.toHaveBeenCalled();
    });

    it('rejectLeaguePendingConfirmation returns CONFIRMED when already confirmed', async () => {
      txMemberRepo.findOne.mockResolvedValue({
        leagueId: 'league-1',
        userId: USER_B1,
      } as LeagueMember);
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(
          fakeMatch({
            id: 'match-1',
            leagueId: 'league-1',
            status: MatchResultStatus.CONFIRMED,
          }),
        ),
      } as any);

      const result = await service.rejectLeaguePendingConfirmation(
        USER_B1,
        'league-1',
        'match-1',
      );

      expect(result).toEqual({
        status: 'CONFIRMED',
        matchId: 'match-1',
      });
      expect(txMatchRepo.save).not.toHaveBeenCalled();
    });

    it('rejectLeaguePendingConfirmation returns REJECTED when already rejected', async () => {
      txMemberRepo.findOne.mockResolvedValue({
        leagueId: 'league-1',
        userId: USER_B1,
      } as LeagueMember);
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(
          fakeMatch({
            id: 'match-1',
            leagueId: 'league-1',
            status: MatchResultStatus.REJECTED,
          }),
        ),
      } as any);

      const result = await service.rejectLeaguePendingConfirmation(
        USER_B1,
        'league-1',
        'match-1',
      );

      expect(result).toEqual({
        status: 'REJECTED',
        matchId: 'match-1',
      });
      expect(txMatchRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('adminConfirmMatch', () => {
    it('allows league admin to confirm pending league match and writes audit log', async () => {
      const pendingMatch = fakeMatch({
        status: MatchResultStatus.PENDING_CONFIRM,
        reportedByUserId: USER_A1,
        confirmedByUserId: null,
        leagueId: 'league-1',
      });
      const eloService = (service as any).eloService as { applyForMatchTx: jest.Mock };
      eloService.applyForMatchTx.mockResolvedValue({ ok: true });

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(pendingMatch),
      });
      txMemberRepo.findOne.mockResolvedValue({
        leagueId: 'league-1',
        userId: ADMIN,
        role: 'admin',
      });
      txChallengeRepo.findOne.mockResolvedValue(fakeChallenge());
      txMatchRepo.save.mockResolvedValue({
        ...pendingMatch,
        status: MatchResultStatus.CONFIRMED,
        confirmedByUserId: ADMIN,
      });
      txAuditRepo.create.mockImplementation((v: any) => v);
      txAuditRepo.save.mockResolvedValue({ id: 'audit-admin-confirm' });
      txMatchRepo.findOne.mockResolvedValue({
        ...pendingMatch,
        status: MatchResultStatus.CONFIRMED,
        confirmedByUserId: ADMIN,
      });

      const result = await service.adminConfirmMatch(ADMIN, 'match-1');

      expect(result?.status).toBe(MatchResultStatus.CONFIRMED);
      expect(txAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: MatchAuditAction.ADMIN_CONFIRM,
          payload: { reason: 'ADMIN_CONFIRM' },
        }),
      );
      expect(leagueStandingsService.recomputeForMatch).toHaveBeenCalledWith(
        expect.any(Object),
        'match-1',
      );
    });

    it('rejects when caller is not league admin', async () => {
      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(
          fakeMatch({
            status: MatchResultStatus.PENDING_CONFIRM,
            leagueId: 'league-1',
            confirmedByUserId: null,
          }),
        ),
      });
      txMemberRepo.findOne.mockResolvedValue({
        leagueId: 'league-1',
        userId: USER_B1,
        role: 'member',
      });

      await expect(service.adminConfirmMatch(USER_B1, 'match-1')).rejects.toMatchObject({
        response: { code: 'LEAGUE_FORBIDDEN' },
      });
    });
  });

  describe('getById flags', () => {
    it('returns action flags for the current user', async () => {
      matchRepo.findOne.mockResolvedValue({
        ...fakeMatch({
          status: MatchResultStatus.PENDING_CONFIRM,
          reportedByUserId: USER_A1,
          confirmedByUserId: null,
          leagueId: 'league-1',
        }),
        challenge: fakeChallenge(),
      } as any);

      const result = await service.getById('match-1', USER_B1);

      expect(result).toEqual(
        expect.objectContaining({
          canConfirm: true,
          awaitingMyConfirmation: true,
          isReporter: false,
          canDispute: false,
          leagueId: 'league-1',
        }),
      );
    });
  });
});
