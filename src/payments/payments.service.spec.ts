import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { PaymentIntent } from './payment-intent.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { PaymentEvent } from './payment-event.entity';
import { Reservation } from '@/modules/reservations/reservation.entity';
import { createMockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource } from '@/test-utils/mock-datasource';

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const dataSource = createMockDataSource();
    const configService = { get: jest.fn() };
    const intentRepo = createMockRepo<PaymentIntent>();
    const txRepo = createMockRepo<PaymentTransaction>();
    const eventRepo = createMockRepo<PaymentEvent>();
    const reservationRepo = createMockRepo<Reservation>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(PaymentIntent), useValue: intentRepo },
        { provide: getRepositoryToken(PaymentTransaction), useValue: txRepo },
        { provide: getRepositoryToken(PaymentEvent), useValue: eventRepo },
        { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
