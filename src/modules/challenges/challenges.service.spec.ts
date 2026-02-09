import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChallengesService } from './challenges.service';
import { Challenge } from './challenge.entity';
import { UsersService } from '../users/users.service';
import { CompetitiveService } from '../competitive/competitive.service';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { createMockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource } from '@/test-utils/mock-datasource';

describe('ChallengesService', () => {
  let service: ChallengesService;

  beforeEach(async () => {
    const dataSource = createMockDataSource();
    const challengeRepo = createMockRepo<Challenge>();
    const usersService = { findById: jest.fn() };
    const competitiveService = { getOrCreateProfile: jest.fn() };
    const userNotifications = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesService,
        { provide: DataSource, useValue: dataSource },
        { provide: UsersService, useValue: usersService },
        { provide: CompetitiveService, useValue: competitiveService },
        { provide: UserNotificationsService, useValue: userNotifications },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
      ],
    }).compile();

    service = module.get<ChallengesService>(ChallengesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
