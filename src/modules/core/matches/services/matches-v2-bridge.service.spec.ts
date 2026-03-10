import { Test, TestingModule } from '@nestjs/testing';
import { MatchQueryService } from '../../matches-v2/services/match-query.service';
import { MatchesV2BridgeService } from './matches-v2-bridge.service';

describe('MatchesV2BridgeService', () => {
  let service: MatchesV2BridgeService;
  let matchQueryService: {
    listMyMatches: jest.Mock;
  };

  beforeEach(async () => {
    matchQueryService = {
      listMyMatches: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesV2BridgeService,
        { provide: MatchQueryService, useValue: matchQueryService },
      ],
    }).compile();

    service = module.get(MatchesV2BridgeService);
  });

  it('exhausts canonical pagination so the legacy controller keeps returning the full list', async () => {
    matchQueryService.listMyMatches
      .mockResolvedValueOnce({
        items: [{ id: 'match-v2-1' }, { id: 'match-v2-2' }],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'match-v2-3' }],
        nextCursor: null,
      });

    const result = await service.listMyMatches('user-1');

    expect(result).toEqual({
      items: [{ id: 'match-v2-1' }, { id: 'match-v2-2' }, { id: 'match-v2-3' }],
      nextCursor: null,
    });
    expect(matchQueryService.listMyMatches).toHaveBeenNthCalledWith(
      1,
      'user-1',
      {
        cursor: undefined,
        limit: 50,
      },
    );
    expect(matchQueryService.listMyMatches).toHaveBeenNthCalledWith(
      2,
      'user-1',
      {
        cursor: 'cursor-1',
        limit: 50,
      },
    );
  });
});
