import { Test, TestingModule } from '@nestjs/testing';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChallengesController],
      providers: [
        { provide: ChallengesService, useValue: challengesService },
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
