import { Test, TestingModule } from '@nestjs/testing';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubAccessGuard } from '../club-members/club-access.guard';

describe('AvailabilityController', () => {
  let controller: AvailabilityController;

  beforeEach(async () => {
    const availabilityService = {
      createRule: jest.fn(),
      bulkCreate: jest.fn(),
      listByCourt: jest.fn(),
      calculateAvailability: jest.fn(),
      createOverride: jest.fn(),
      listOverrides: jest.fn(),
      deleteOverride: jest.fn(),
      cleanupDuplicates: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AvailabilityController],
      providers: [
        { provide: AvailabilityService, useValue: availabilityService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    })
      .overrideGuard(ClubAccessGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AvailabilityController>(AvailabilityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
