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
import { MatchResult, MatchResultStatus } from './match-result.entity';
import { MatchDispute } from './match-dispute.entity';
import { MatchAuditLog } from './match-audit-log.entity';
import { Challenge } from '../challenges/challenge.entity';
import { User } from '../users/user.entity';
import { EloService } from '../competitive/elo.service';
import { LeagueStandingsService } from '../leagues/league-standings.service';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { UserNotificationType } from '../../notifications/user-notification-type.enum';
import { DisputeReasonCode } from './dispute-reason.enum';
import { DisputeStatus } from './dispute-status.enum';
import { DisputeResolution } from './dto/resolve-dispute.dto';
import { MatchAuditAction } from './match-audit-action.enum';
import { Reservation, ReservationStatus } from '../reservations/reservation.entity';
import { League } from '../leagues/league.entity';
import { LeagueMember } from '../leagues/league-member.entity';
import { LeagueStatus } from '../leagues/league-status.enum';
import { createMockRepo, MockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource, MockDataSource } from '@/test-utils/mock-datasource';

const USER_A1 = 'a1111111-1111-4111-a111-111111111111';
const USER_A2 = 'a2222222-2222-4222-a222-222222222222';
const USER_B1 = 'b1111111-1111-4111-b111-111111111111';
const USER_B2 = 'b2222222-2222-4222-b222-222222222222';
const OUTSIDER = 'c3333333-3333-4333-c333-333333333333';
const ADMIN = 'd4444444-4444-4444-d444-444444444444';

function fakeChallenge(): Challenge {
  return {
    id: 'challenge-1',
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
          return createMockRepo();
        }),
        save: jest.fn().mockImplementation(async (entity: any) => entity),
      };
      return cb(manager);
    });

    // Default user lookup
    userRepo.findOne.mockResolvedValue({ id: USER_B1, displayName: 'Player B1' });

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
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.DISPUTED });
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
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.DISPUTED });
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
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.CONFIRMED });
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
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.RESOLVED });
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
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.CONFIRMED });
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
      const match = fakeMatch({ status: MatchResultStatus.DISPUTED });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({ ...dispute, status: DisputeStatus.RESOLVED });
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.CONFIRMED });
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

    it('should NOT call recomputeForMatch on VOID_MATCH', async () => {
      const match = fakeMatch({ status: MatchResultStatus.DISPUTED });
      const dispute = fakeDispute();

      txMatchRepo.createQueryBuilder.mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(match),
      });
      txDisputeRepo.findOne.mockResolvedValue(dispute);
      txDisputeRepo.save.mockResolvedValue({ ...dispute, status: DisputeStatus.RESOLVED });
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.RESOLVED });
      txAuditRepo.create.mockReturnValue({ id: 'audit-6' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-6' });
      challengeRepo.findOne.mockResolvedValue(fakeChallenge());

      await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.VOID_MATCH,
      });

      expect(leagueStandingsService.recomputeForMatch).not.toHaveBeenCalled();
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
      sets: [{ a: 6, b: 3 }, { a: 6, b: 4 }],
    };

    function setupHappyPath() {
      txLeagueRepo.findOne.mockResolvedValue({
        id: LEAGUE_ID,
        status: LeagueStatus.ACTIVE,
      });
      txMemberRepo.findOne.mockResolvedValue({ userId: USER_A1, leagueId: LEAGUE_ID });
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
      txChallengeRepo.create.mockImplementation((v: any) => ({ id: 'ch-new', ...v }));
      txChallengeRepo.save.mockImplementation(async (v: any) => v);
      txMatchRepo.create.mockImplementation((v: any) => ({ id: 'match-new', ...v }));
      txMatchRepo.save.mockImplementation(async (v: any) => v);
    }

    it('should create a match from a valid reservation', async () => {
      setupHappyPath();

      const result = await service.reportFromReservation(USER_A1, LEAGUE_ID, validDto);

      expect(result.id).toBe('match-new');
      expect(result.leagueId).toBe(LEAGUE_ID);
      expect(result.status).toBe(MatchResultStatus.PENDING_CONFIRM);
      expect(txChallengeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ reservationId: RESERVATION_ID }),
      );
    });

    it('should throw LEAGUE_FORBIDDEN if caller is not a member', async () => {
      txLeagueRepo.findOne.mockResolvedValue({ id: LEAGUE_ID, status: LeagueStatus.ACTIVE });
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
      txLeagueRepo.findOne.mockResolvedValue({ id: LEAGUE_ID, status: LeagueStatus.ACTIVE });
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
      txLeagueRepo.findOne.mockResolvedValue({ id: LEAGUE_ID, status: LeagueStatus.ACTIVE });
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
      txLeagueRepo.findOne.mockResolvedValue({ id: LEAGUE_ID, status: LeagueStatus.ACTIVE });
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
      dsMemberRepo.find.mockResolvedValue([{ userId: USER_A1, leagueId: LEAGUE_ID }]);
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
});
