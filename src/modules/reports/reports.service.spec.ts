import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { Reservation } from '../reservations/reservation.entity';
import { Court } from '../courts/court.entity';
import { createMockRepo } from '@/test-utils/mock-repo';

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const reservationRepo = createMockRepo<Reservation>();
    const courtRepo = createMockRepo<Court>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
        { provide: getRepositoryToken(Court), useValue: courtRepo },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
