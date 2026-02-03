import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MatchesService } from './matches.service';
import { MatchResult } from './match-result.entity';
import { Challenge } from '../challenges/challenge.entity';
import { EloService } from '../competitive/elo.service';
import { createMockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource } from '@/test-utils/mock-datasource';

describe('MatchesService', () => {
  let service: MatchesService;

  beforeEach(async () => {
    const dataSource = createMockDataSource();
    const matchRepo = createMockRepo<MatchResult>();
    const challengeRepo = createMockRepo<Challenge>();
    const eloService = { applyForMatchTx: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(MatchResult), useValue: matchRepo },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: EloService, useValue: eloService },
      ],
    }).compile();

    service = module.get<MatchesService>(MatchesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
