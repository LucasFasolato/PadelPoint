import { Test, TestingModule } from '@nestjs/testing';
import { CourtsController } from './courts.controller';
import { CourtsService } from './courts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubAccessGuard } from '../club-members/club-access.guard';

describe('CourtsController', () => {
  let controller: CourtsController;

  beforeEach(async () => {
    const courtsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      findByClub: jest.fn(),
      findByClubPublic: jest.fn(),
      findOnePublic: jest.fn(),
      getAvailability: jest.fn(),
      getSingleCourtAvailability: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourtsController],
      providers: [
        { provide: CourtsService, useValue: courtsService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    })
      .overrideGuard(ClubAccessGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<CourtsController>(CourtsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
