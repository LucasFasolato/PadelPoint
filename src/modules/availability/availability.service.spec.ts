import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AvailabilityService } from './availability.service';
import { CourtAvailabilityRule } from './court-availability-rule.entity';
import { CourtAvailabilityOverride } from './court-availability-override.entity';
import { Court } from '../courts/court.entity';
import { createMockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource } from '@/test-utils/mock-datasource';

describe('AvailabilityService', () => {
  let service: AvailabilityService;

  beforeEach(async () => {
    const dataSource = createMockDataSource();
    const ruleRepo = createMockRepo<CourtAvailabilityRule>();
    const courtRepo = createMockRepo<Court>();
    const overrideRepo = createMockRepo<CourtAvailabilityOverride>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(CourtAvailabilityRule),
          useValue: ruleRepo,
        },
        { provide: getRepositoryToken(Court), useValue: courtRepo },
        {
          provide: getRepositoryToken(CourtAvailabilityOverride),
          useValue: overrideRepo,
        },
      ],
    }).compile();

    service = module.get<AvailabilityService>(AvailabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
