import { Test, TestingModule } from '@nestjs/testing';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ClubAccessGuard } from '../club-members/club-access.guard';

describe('ClubsController', () => {
  let controller: ClubsController;

  beforeEach(async () => {
    const clubsService = {
      search: jest.fn(),
      findClubsManagedByUser: jest.fn(),
      create: jest.fn(),
      findAllPublic: jest.fn(),
      findOnePublic: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClubsController],
      providers: [
        { provide: ClubsService, useValue: clubsService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
        { provide: RolesGuard, useValue: { canActivate: jest.fn(() => true) } },
      ],
    })
      .overrideGuard(ClubAccessGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<ClubsController>(ClubsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
