import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClubMembersService } from './club-members.service';
import { ClubMember } from './club-member.entity';
import { UsersService } from '../users/users.service';
import { createMockRepo } from '@/test-utils/mock-repo';

describe('ClubMembersService', () => {
  let service: ClubMembersService;

  beforeEach(async () => {
    const clubMemberRepo = createMockRepo<ClubMember>();
    const usersService = { findByEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubMembersService,
        { provide: getRepositoryToken(ClubMember), useValue: clubMemberRepo },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get<ClubMembersService>(ClubMembersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
