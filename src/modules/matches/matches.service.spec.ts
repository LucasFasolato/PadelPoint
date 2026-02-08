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
  let userNotifications: { create: jest.Mock };

  // Mock repos returned inside transactions
  let txMatchRepo: MockRepo<MatchResult>;
  let txDisputeRepo: MockRepo<MatchDispute>;
  let txAuditRepo: MockRepo<MatchAuditLog>;
  let txChallengeRepo: MockRepo<Challenge>;

  beforeEach(async () => {
    dataSource = createMockDataSource();
    matchRepo = createMockRepo<MatchResult>();
    challengeRepo = createMockRepo<Challenge>();
    disputeRepo = createMockRepo<MatchDispute>();
    auditRepo = createMockRepo<MatchAuditLog>();
    userRepo = createMockRepo<User>();
    userNotifications = { create: jest.fn().mockResolvedValue({}) };

    // Transaction mock repos
    txMatchRepo = createMockRepo<MatchResult>();
    txDisputeRepo = createMockRepo<MatchDispute>();
    txAuditRepo = createMockRepo<MatchAuditLog>();
    txChallengeRepo = createMockRepo<Challenge>();

    // Default: transaction executes callback with a mock manager
    dataSource.transaction.mockImplementation(async (cb: any) => {
      const manager = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === MatchResult) return txMatchRepo;
          if (entity === MatchDispute) return txDisputeRepo;
          if (entity === MatchAuditLog) return txAuditRepo;
          if (entity === Challenge) return txChallengeRepo;
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
        { provide: EloService, useValue: { applyForMatchTx: jest.fn() } },
        { provide: LeagueStandingsService, useValue: { recomputeForMatch: jest.fn() } },
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
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.RESOLVED });
      txAuditRepo.create.mockReturnValue({ id: 'audit-2' });
      txAuditRepo.save.mockResolvedValue({ id: 'audit-2' });

      const result = await service.resolveDispute(ADMIN, 'match-1', {
        resolution: DisputeResolution.CONFIRM_AS_IS,
      });

      expect(result.matchStatus).toBe(MatchResultStatus.RESOLVED);
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
      txMatchRepo.save.mockResolvedValue({ ...match, status: MatchResultStatus.RESOLVED });
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
  });
});
