import { Test, TestingModule } from '@nestjs/testing';
import { CompetitiveController } from './competitive.controller';
import { CompetitiveService } from './competitive.service';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';

describe('CompetitiveController', () => {
  let controller: CompetitiveController;

  beforeEach(async () => {
    const competitiveService = {
      getOrCreateProfile: jest.fn(),
      initProfileCategory: jest.fn(),
      eloHistory: jest.fn(),
      getSkillRadar: jest.fn(),
      findRivalSuggestions: jest.fn(),
      findPartnerSuggestions: jest.fn(),
      listChallenges: jest.fn(),
      ranking: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompetitiveController],
      providers: [
        { provide: CompetitiveService, useValue: competitiveService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    }).compile();

    controller = module.get<CompetitiveController>(CompetitiveController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
