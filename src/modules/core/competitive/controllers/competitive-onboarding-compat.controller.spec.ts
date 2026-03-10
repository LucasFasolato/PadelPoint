import { Test, TestingModule } from '@nestjs/testing';
import { CompetitiveOnboardingCompatController } from './competitive-onboarding-compat.controller';
import { CompetitiveService } from '../services/competitive.service';
import { JwtAuthGuard } from '@/modules/core/auth/guards/jwt-auth.guard';
import { CityRequiredGuard } from '@common/guards/city-required.guard';

describe('CompetitiveOnboardingCompatController', () => {
  let controller: CompetitiveOnboardingCompatController;
  let competitiveService: { upsertOnboarding: jest.Mock };

  beforeEach(async () => {
    competitiveService = { upsertOnboarding: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompetitiveOnboardingCompatController],
      providers: [
        { provide: CompetitiveService, useValue: competitiveService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
        {
          provide: CityRequiredGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    }).compile();

    controller = module.get<CompetitiveOnboardingCompatController>(
      CompetitiveOnboardingCompatController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates POST /players/me/onboarding to CompetitiveService.upsertOnboarding', async () => {
    const userId = 'user-uuid-123';
    const dto = { category: '7ma' } as any;
    const expected = { id: userId, category: '7ma' };
    competitiveService.upsertOnboarding.mockResolvedValue(expected);

    const req = {
      user: { userId, email: 'test@test.com', role: 'player' },
    } as any;
    const result = await controller.upsertOnboarding(req, dto);

    expect(competitiveService.upsertOnboarding).toHaveBeenCalledWith(
      userId,
      dto,
    );
    expect(result).toBe(expected);
  });
});
