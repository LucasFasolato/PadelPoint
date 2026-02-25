import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { PaymentIntent } from './payment-intent.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { PaymentEvent } from './payment-event.entity';
import { Reservation } from '@/modules/reservations/reservation.entity';
import { EventLog } from '@/common/event-log.entity';
import { createMockRepo } from '@/test-utils/mock-repo';
import { createMockDataSource } from '@/test-utils/mock-datasource';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let dataSource: ReturnType<typeof createMockDataSource>;
  let intentRepo: ReturnType<typeof createMockRepo<PaymentIntent>>;
  let txRepo: ReturnType<typeof createMockRepo<PaymentTransaction>>;
  let eventRepo: ReturnType<typeof createMockRepo<PaymentEvent>>;
  let eventLogRepo: ReturnType<typeof createMockRepo<EventLog>>;
  let reservationRepo: ReturnType<typeof createMockRepo<Reservation>>;

  beforeEach(async () => {
    dataSource = createMockDataSource();
    const configService = { get: jest.fn() };
    intentRepo = createMockRepo<PaymentIntent>();
    txRepo = createMockRepo<PaymentTransaction>();
    eventRepo = createMockRepo<PaymentEvent>();
    eventLogRepo = createMockRepo<EventLog>();
    reservationRepo = createMockRepo<Reservation>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(PaymentIntent), useValue: intentRepo },
        { provide: getRepositoryToken(PaymentTransaction), useValue: txRepo },
        { provide: getRepositoryToken(PaymentEvent), useValue: eventRepo },
        { provide: getRepositoryToken(EventLog), useValue: eventLogRepo },
        { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('handles webhook idempotently when providerEventId already exists', async () => {
    const existingEvent = {
      id: 'evt-1',
      paymentIntentId: 'pi-1',
      providerEventId: 'prov-1',
    } as PaymentEvent;

    eventRepo.findOne.mockResolvedValue(existingEvent);
    intentRepo.findOne.mockResolvedValue({
      id: 'pi-1',
      referenceType: 'RESERVATION',
      referenceId: 'res-1',
      status: 'APPROVED',
    } as PaymentIntent);
    reservationRepo.findOne.mockResolvedValue({
      id: 'res-1',
      status: 'confirmed',
    } as Reservation);

    dataSource.transaction.mockImplementation(async (cb) => {
      type RepoUnion =
        | typeof eventRepo
        | typeof intentRepo
        | typeof txRepo
        | typeof reservationRepo
        | typeof eventLogRepo;
      const manager: { getRepository: (entity: unknown) => RepoUnion } = {
        getRepository: (entity: unknown) => {
          if (entity === PaymentEvent) return eventRepo;
          if (entity === PaymentIntent) return intentRepo;
          if (entity === PaymentTransaction) return txRepo;
          if (entity === Reservation) return reservationRepo;
          if (entity === EventLog) return eventLogRepo;
          return eventRepo;
        },
      };
      return cb(manager);
    });

    const result = await service.handleMockWebhook({
      providerEventId: 'prov-1',
      intentId: 'pi-1',
      status: 'approved',
    });

    expect(result).toEqual({
      ok: true,
      idempotent: true,
      paymentIntentId: 'pi-1',
      paymentStatus: 'APPROVED',
      reservationStatus: 'confirmed',
    });
    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it('approves payment and confirms reservation on webhook approved', async () => {
    eventRepo.findOne.mockResolvedValue(null);
    intentRepo.findOne.mockResolvedValue({
      id: 'pi-1',
      referenceType: 'RESERVATION',
      referenceId: 'res-1',
      status: 'PENDING',
    } as PaymentIntent);
    reservationRepo.findOne.mockResolvedValue({
      id: 'res-1',
      status: 'payment_pending',
      checkoutTokenExpiresAt: new Date(),
    } as Reservation);

    intentRepo.save.mockImplementation(async (input) => input as PaymentIntent);
    reservationRepo.save.mockImplementation(
      async (input) => input as Reservation,
    );

    dataSource.transaction.mockImplementation(async (cb) => {
      type RepoUnion =
        | typeof eventRepo
        | typeof intentRepo
        | typeof txRepo
        | typeof reservationRepo
        | typeof eventLogRepo;
      const manager: { getRepository: (entity: unknown) => RepoUnion } = {
        getRepository: (entity: unknown) => {
          if (entity === PaymentEvent) return eventRepo;
          if (entity === PaymentIntent) return intentRepo;
          if (entity === PaymentTransaction) return txRepo;
          if (entity === Reservation) return reservationRepo;
          if (entity === EventLog) return eventLogRepo;
          return eventRepo;
        },
      };
      return cb(manager);
    });

    const result = await service.handleMockWebhook({
      providerEventId: 'prov-2',
      intentId: 'pi-1',
      status: 'approved',
    });

    expect(eventRepo.save).toHaveBeenCalled();
    expect(intentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED' }),
    );
    expect(reservationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed' }),
    );
    expect(txRepo.save).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      idempotent: false,
      paymentIntentId: 'pi-1',
      paymentStatus: 'APPROVED',
      reservationStatus: 'confirmed',
    });
  });
});
