import { Test, TestingModule } from '@nestjs/testing';
import { MatchesController } from '../controllers/matches.controller';
import { MatchesService } from '../services/matches.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';

describe('MatchesController', () => {
  let controller: MatchesController;
  let matchesService: {
    getMyMatches: jest.Mock;
    reportMatch: jest.Mock;
    confirmMatch: jest.Mock;
    rejectMatch: jest.Mock;
    getById: jest.Mock;
    getByChallenge: jest.Mock;
  };

  beforeEach(async () => {
    matchesService = {
      getMyMatches: jest.fn(),
      reportMatch: jest.fn(),
      confirmMatch: jest.fn(),
      rejectMatch: jest.fn(),
      getById: jest.fn(),
      getByChallenge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [
        { provide: MatchesService, useValue: matchesService },
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
    matchesService.getMyMatches.mockResolvedValue([{ id: 'match-1' }]);

    const result = await controller.getMyMatches({
      user: { userId: 'user-1' },
    } as any);

    expect(result).toEqual({
      items: [{ id: 'match-1' }],
      nextCursor: null,
    });
    expect(matchesService.getMyMatches).toHaveBeenCalledWith('user-1');
  });

  it('returns legacy array for GET /matches/me?legacy=1', async () => {
    matchesService.getMyMatches.mockResolvedValue([{ id: 'match-1' }]);

    const result = await controller.getMyMatches(
      { user: { userId: 'user-1' } } as any,
      '1',
    );

    expect(result).toEqual([{ id: 'match-1' }]);
    expect(matchesService.getMyMatches).toHaveBeenCalledWith('user-1');
  });
});
