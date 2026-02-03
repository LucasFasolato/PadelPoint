import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClubAccessGuard } from '../club-members/club-access.guard';

describe('ReservationsController', () => {
  let controller: ReservationsController;

  beforeEach(async () => {
    const reservationsService = {
      listUserMatches: jest.fn(),
      createHold: jest.fn(),
      confirm: jest.fn(),
      cancel: jest.fn(),
      getById: jest.fn(),
      listReservations: jest.fn(),
      listByClubRange: jest.fn(),
      listByCourtRange: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [
        { provide: ReservationsService, useValue: reservationsService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
      ],
    })
      .overrideGuard(ClubAccessGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<ReservationsController>(ReservationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
