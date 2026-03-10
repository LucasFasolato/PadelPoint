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
    rejectMatch: jest.Mock;
    getById: jest.Mock;
    getByChallenge: jest.Mock;
  };
  let matchesV2BridgeService: {
    listMyMatches: jest.Mock;
    listPendingConfirmations: jest.Mock;
  };

  beforeEach(async () => {
    matchesService = {
      getMyMatches: jest.fn(),
      getPendingConfirmations: jest.fn(),
      getRankingImpact: jest.fn(),
      reportMatch: jest.fn(),
      confirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      getById: jest.fn(),
      getByChallenge: jest.fn(),
    };
    matchesV2BridgeService = {
      listMyMatches: jest.fn(),
      listPendingConfirmations: jest.fn(),
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
});
