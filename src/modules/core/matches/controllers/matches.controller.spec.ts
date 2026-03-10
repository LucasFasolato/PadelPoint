import { Test, TestingModule } from '@nestjs/testing';
import { MatchesController } from '../controllers/matches.controller';
import { MatchesService } from '../services/matches.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { MatchesV2BridgeService } from '../services/matches-v2-bridge.service';

describe('MatchesController', () => {
  let controller: MatchesController;
  let matchesService: {
    getMyMatches: jest.Mock;
    getPendingConfirmations: jest.Mock;
    getRankingImpact: jest.Mock;
    reportMatch: jest.Mock;
    confirmMatch: jest.Mock;
    adminConfirmMatch: jest.Mock;
    rejectMatch: jest.Mock;
    disputeMatch: jest.Mock;
    resolveDispute: jest.Mock;
    resolveConfirmAsIs: jest.Mock;
    getById: jest.Mock;
    getByChallenge: jest.Mock;
  };
  let matchesV2BridgeService: {
    listMyMatches: jest.Mock;
    listPendingConfirmations: jest.Mock;
    reportResult: jest.Mock;
    confirmResult: jest.Mock;
    rejectResult: jest.Mock;
    openDispute: jest.Mock;
    resolveDispute: jest.Mock;
  };

  beforeEach(async () => {
    matchesService = {
      getMyMatches: jest.fn(),
      getPendingConfirmations: jest.fn(),
      getRankingImpact: jest.fn(),
      reportMatch: jest.fn(),
      confirmMatch: jest.fn(),
      adminConfirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      disputeMatch: jest.fn(),
      resolveDispute: jest.fn(),
      resolveConfirmAsIs: jest.fn(),
      getById: jest.fn(),
      getByChallenge: jest.fn(),
    };
    matchesV2BridgeService = {
      listMyMatches: jest.fn(),
      listPendingConfirmations: jest.fn(),
      reportResult: jest.fn(),
      confirmResult: jest.fn(),
      rejectResult: jest.fn(),
      openDispute: jest.fn(),
      resolveDispute: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [
        { provide: MatchesService, useValue: matchesService },
        {
          provide: MatchesV2BridgeService,
          useValue: matchesV2BridgeService,
        },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    }).compile();

    controller = module.get<MatchesController>(MatchesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns wrapped response for GET /matches/me by default', async () => {
    matchesV2BridgeService.listMyMatches.mockResolvedValue({
      items: [{ id: 'match-v2-1' }],
      nextCursor: null,
    });

    const result = await controller.getMyMatches({
      user: { userId: 'user-1' },
    } as any);

    expect(result).toEqual({
      items: [{ id: 'match-v2-1' }],
      nextCursor: null,
    });
    expect(matchesV2BridgeService.listMyMatches).toHaveBeenCalledWith('user-1');
    expect(matchesService.getMyMatches).not.toHaveBeenCalled();
  });

  it('returns legacy array for GET /matches/me?legacy=1', async () => {
    matchesService.getMyMatches.mockResolvedValue([{ id: 'match-1' }]);

    const result = await controller.getMyMatches(
      { user: { userId: 'user-1' } } as any,
      '1',
    );

    expect(result).toEqual([{ id: 'match-1' }]);
    expect(matchesService.getMyMatches).toHaveBeenCalledWith('user-1');
    expect(matchesV2BridgeService.listMyMatches).not.toHaveBeenCalled();
  });

  it('delegates GET /matches/me/pending-confirmations to matches-v2 by default', async () => {
    matchesV2BridgeService.listPendingConfirmations.mockResolvedValue({
      items: [
        {
          id: 'match-v2-1',
          matchId: 'match-v2-1',
          status: 'PENDING_CONFIRMATION',
          opponentName: 'Rival 1',
          cta: { primary: 'Confirmar', href: '/matches/match-v2-1' },
        },
      ],
      nextCursor: 'cursor-1',
    });

    const result = await controller.getPendingConfirmations(
      {
        user: { userId: 'user-1' },
        headers: { 'x-request-id': 'req-1' },
        res: {
          getHeader: jest.fn().mockReturnValue(undefined),
          setHeader: jest.fn(),
        },
      } as any,
      { cursor: 'legacy-cursor-1', limit: 10 },
    );

    expect(result).toEqual({
      items: [
        {
          id: 'match-v2-1',
          matchId: 'match-v2-1',
          status: 'PENDING_CONFIRMATION',
          opponentName: 'Rival 1',
          cta: { primary: 'Confirmar', href: '/matches/match-v2-1' },
        },
      ],
      nextCursor: 'cursor-1',
    });
    expect(
      matchesV2BridgeService.listPendingConfirmations,
    ).toHaveBeenCalledWith('user-1', {
      cursor: 'legacy-cursor-1',
      limit: 10,
    });
    expect(matchesService.getPendingConfirmations).not.toHaveBeenCalled();
  });

  it('keeps the legacy path for GET /matches/me/pending-confirmations?legacy=1', async () => {
    matchesService.getPendingConfirmations.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    const result = await controller.getPendingConfirmations(
      {
        user: { userId: 'user-1' },
        headers: { 'x-request-id': 'req-legacy-1' },
        res: {
          getHeader: jest.fn().mockReturnValue(undefined),
          setHeader: jest.fn(),
        },
      } as any,
      { cursor: undefined, limit: 20 },
      '1',
    );

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(matchesService.getPendingConfirmations).toHaveBeenCalledWith(
      'user-1',
      {
        cursor: undefined,
        limit: 20,
        requestId: 'req-legacy-1',
      },
    );
    expect(
      matchesV2BridgeService.listPendingConfirmations,
    ).not.toHaveBeenCalled();
  });

  it('keeps GET /matches/:id on the legacy service', async () => {
    matchesService.getById.mockResolvedValue({ id: 'match-legacy-1' });

    const result = await controller.getById(
      { user: { userId: 'user-1' } } as any,
      'match-legacy-1',
    );

    expect(result).toEqual({ id: 'match-legacy-1' });
    expect(matchesService.getById).toHaveBeenCalledWith(
      'match-legacy-1',
      'user-1',
    );
  });

  it('delegates POST /matches to the matches-v2 bridge', async () => {
    matchesV2BridgeService.reportResult.mockResolvedValue({ id: 'match-1' });

    const dto = {
      challengeId: 'challenge-1',
      sets: [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
      ],
    };
    const result = await controller.report(
      { user: { userId: 'user-1' } } as any,
      dto as any,
    );

    expect(result).toEqual({ id: 'match-1' });
    expect(matchesV2BridgeService.reportResult).toHaveBeenCalledWith(
      'user-1',
      dto,
    );
    expect(matchesService.reportMatch).not.toHaveBeenCalled();
  });

  it('delegates PATCH /matches/:id/confirm to the matches-v2 bridge', async () => {
    matchesV2BridgeService.confirmResult.mockResolvedValue({
      id: 'match-1',
      status: 'confirmed',
    });

    const result = await controller.confirm(
      { user: { userId: 'user-1' } } as any,
      'match-1',
    );

    expect(result).toEqual({ id: 'match-1', status: 'confirmed' });
    expect(matchesV2BridgeService.confirmResult).toHaveBeenCalledWith(
      'user-1',
      'match-1',
    );
    expect(matchesService.confirmMatch).not.toHaveBeenCalled();
  });

  it('delegates PATCH /matches/:id/reject to the matches-v2 bridge', async () => {
    matchesV2BridgeService.rejectResult.mockResolvedValue({
      id: 'match-1',
      status: 'rejected',
    });

    const result = await controller.reject(
      { user: { userId: 'user-1' } } as any,
      'match-1',
      { reason: 'wrong score' } as any,
    );

    expect(result).toEqual({ id: 'match-1', status: 'rejected' });
    expect(matchesV2BridgeService.rejectResult).toHaveBeenCalledWith(
      'user-1',
      'match-1',
      'wrong score',
    );
    expect(matchesService.rejectMatch).not.toHaveBeenCalled();
  });

  it('delegates POST /matches/:id/dispute to the matches-v2 bridge', async () => {
    matchesV2BridgeService.openDispute.mockResolvedValue({
      dispute: { id: 'dispute-1' },
      matchStatus: 'disputed',
    });
    const dto = { reasonCode: 'wrong_score' };

    const result = await controller.dispute(
      { user: { userId: 'user-1' } } as any,
      'match-1',
      dto as any,
    );

    expect(result).toEqual({
      dispute: { id: 'dispute-1' },
      matchStatus: 'disputed',
    });
    expect(matchesV2BridgeService.openDispute).toHaveBeenCalledWith(
      'user-1',
      'match-1',
      dto,
    );
    expect(matchesService.disputeMatch).not.toHaveBeenCalled();
  });

  it('delegates POST /matches/:id/resolve to the matches-v2 bridge for admins', async () => {
    matchesV2BridgeService.resolveDispute.mockResolvedValue({
      resolution: 'confirm_as_is',
    });
    const dto = { resolution: 'confirm_as_is' };

    const result = await controller.resolve(
      { user: { userId: 'admin-1', role: 'admin' } } as any,
      'match-1',
      dto as any,
    );

    expect(result).toEqual({ resolution: 'confirm_as_is' });
    expect(matchesV2BridgeService.resolveDispute).toHaveBeenCalledWith(
      'admin-1',
      'match-1',
      dto,
    );
    expect(matchesService.resolveDispute).not.toHaveBeenCalled();
  });
});
