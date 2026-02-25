import { Test, TestingModule } from '@nestjs/testing';
import { CompetitiveController } from '../controllers/competitive.controller';
import { CompetitiveService } from '../services/competitive.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';

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
