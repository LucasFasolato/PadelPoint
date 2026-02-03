import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CourtsService } from './courts.service';
import { Court } from './court.entity';
import { Club } from '../clubs/club.entity';
import { Reservation } from '../reservations/reservation.entity';
import { createMockRepo } from '@/test-utils/mock-repo';

describe('CourtsService', () => {
  let service: CourtsService;

  beforeEach(async () => {
    const courtRepo = createMockRepo<Court>();
    const clubRepo = createMockRepo<Club>();
    const reservationRepo = createMockRepo<Reservation>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourtsService,
        { provide: getRepositoryToken(Court), useValue: courtRepo },
        { provide: getRepositoryToken(Club), useValue: clubRepo },
        { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
      ],
    }).compile();

    service = module.get<CourtsService>(CourtsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
