import { Test, TestingModule } from '@nestjs/testing';
import { ChallengesController } from '../controllers/challenges.controller';
import { ChallengesService } from '../services/challenges.service';
import { ChallengeCoordinationService } from '../services/challenge-coordination.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';

describe('ChallengesController', () => {
  let controller: ChallengesController;

  beforeEach(async () => {
    const challengesService = {
      createDirect: jest.fn(),
      createOpen: jest.fn(),
      listOpen: jest.fn(),
      inbox: jest.fn(),
      outbox: jest.fn(),
      getById: jest.fn(),
      acceptDirect: jest.fn(),
      rejectDirect: jest.fn(),
      cancel: jest.fn(),
      acceptOpen: jest.fn(),
      cancelOpen: jest.fn(),
    };
    const challengeCoordinationService = {
      getCoordinationState: jest.fn(),
      listMessages: jest.fn(),
      createProposal: jest.fn(),
      acceptProposal: jest.fn(),
      rejectProposal: jest.fn(),
      createMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChallengesController],
      providers: [
        { provide: ChallengesService, useValue: challengesService },
        {
          provide: ChallengeCoordinationService,
          useValue: challengeCoordinationService,
        },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    }).compile();

    controller = module.get<ChallengesController>(ChallengesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
