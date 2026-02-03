import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CompetitiveService } from './competitive.service';
import { CompetitiveProfile } from './competitive-profile.entity';
import { EloHistory } from './elo-history.entity';
import { UsersService } from '../users/users.service';
import { createMockRepo } from '@/test-utils/mock-repo';

describe('CompetitiveService', () => {
  let service: CompetitiveService;

  beforeEach(async () => {
    const usersService = { findById: jest.fn() };
    const profileRepo = createMockRepo<CompetitiveProfile>();
    const historyRepo = createMockRepo<EloHistory>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitiveService,
        { provide: UsersService, useValue: usersService },
        {
          provide: getRepositoryToken(CompetitiveProfile),
          useValue: profileRepo,
        },
        { provide: getRepositoryToken(EloHistory), useValue: historyRepo },
      ],
    }).compile();

    service = module.get<CompetitiveService>(CompetitiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
