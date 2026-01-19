import { Test, TestingModule } from '@nestjs/testing';
import { ClubMembersService } from './club-members.service';

describe('ClubMembersService', () => {
  let service: ClubMembersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClubMembersService],
    }).compile();

    service = module.get<ClubMembersService>(ClubMembersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
