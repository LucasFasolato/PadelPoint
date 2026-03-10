import { Test, TestingModule } from '@nestjs/testing';
import { MatchesController } from '../controllers/matches.controller';
import { MatchesService } from '../services/matches.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { MatchesV2BridgeService } from '../services/matches-v2-bridge.service';

describe('MatchesController', () => {
  let controller: MatchesController;
  let matchesService: {
    getMyMatches: jest.Mock;
    getRankingImpact: jest.Mock;
    reportMatch: jest.Mock;
    confirmMatch: jest.Mock;
    rejectMatch: jest.Mock;
    getById: jest.Mock;
    getByChallenge: jest.Mock;
  };
  let matchesV2BridgeService: {
    listMyMatches: jest.Mock;
  };

  beforeEach(async () => {
    matchesService = {
      getMyMatches: jest.fn(),
      getRankingImpact: jest.fn(),
      reportMatch: jest.fn(),
      confirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      getById: jest.fn(),
      getByChallenge: jest.fn(),
    };
    matchesV2BridgeService = {
      listMyMatches: jest.fn(),
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
});
