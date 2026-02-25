import { Test, TestingModule } from '@nestjs/testing';
import { ClubMembersController } from './club-members.controller';
import { ClubMembersService } from './club-members.service';
import { ClubAccessGuard } from './club-access.guard';

describe('ClubMembersController', () => {
  let controller: ClubMembersController;

  beforeEach(async () => {
    const clubMembersService = {
      findAllByClub: jest.fn(),
      create: jest.fn(),
      updateMember: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClubMembersController],
      providers: [
        { provide: ClubMembersService, useValue: clubMembersService },
      ],
    })
      .overrideGuard(ClubAccessGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<ClubMembersController>(ClubMembersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
