import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgendaService } from './agenda.service';
import { Court } from '../courts/court.entity';
import { Reservation } from '../reservations/reservation.entity';
import { CourtAvailabilityOverride } from '../availability/court-availability-override.entity';
import { createMockRepo } from '@/test-utils/mock-repo';

describe('AgendaService', () => {
  let service: AgendaService;

  beforeEach(async () => {
    const courtRepo = createMockRepo<Court>();
    const reservationRepo = createMockRepo<Reservation>();
    const overrideRepo = createMockRepo<CourtAvailabilityOverride>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgendaService,
        { provide: getRepositoryToken(Court), useValue: courtRepo },
        { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
        {
          provide: getRepositoryToken(CourtAvailabilityOverride),
          useValue: overrideRepo,
        },
      ],
    }).compile();

    service = module.get<AgendaService>(AgendaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
