import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';

import { ReservationsService } from './reservations.service';
import { Reservation } from './reservation.entity';
import { Court } from '../courts/court.entity';

import { NotificationEventsService } from '@/notifications/notification-events.service';
import { NotificationsService } from '@/notifications/notifications.service';
import {
  NotificationEventType,
  NotificationEventChannel,
} from '@/notifications/notification-event.entity';

type RepoMock<T> = {
  findOne: jest.Mock<Promise<T | null>, any>;
  // firma simple (la que usa tu servicio): save(entity) -> Promise<entity>
  save: jest.Mock<Promise<T>, [Partial<T>]>;
};

type TransactionLike = {
  query: jest.Mock<Promise<Array<{ now: Date }>>, [string]>;
  getRepository: jest.Mock<RepoMock<Reservation>, [typeof Reservation]>;
};

type DataSourceMock = {
  query: jest.Mock<Promise<Array<{ now: Date }>>, [string]>;
  transaction: jest.Mock<
    Promise<unknown>,
    [(trx: TransactionLike) => Promise<unknown>]
  >;
};

type NotificationEventsMock = jest.Mocked<
  Pick<
    NotificationEventsService,
    | 'recordEvent'
    | 'recordEventIfMissing'
    | 'findLatestForReservation'
    | 'findLatestResendAfter'
  >
>;

describe('ReservationsService', () => {
  let service: ReservationsService;
  let moduleRef: TestingModule;

  const notificationEvents: NotificationEventsMock = {
    recordEvent: jest.fn(),
    recordEventIfMissing: jest.fn(),
    findLatestForReservation: jest.fn(),
    findLatestResendAfter: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const reservaRepo: RepoMock<Reservation> & {
      create: (input: Partial<Reservation>) => Reservation;
    } = {
      findOne: jest.fn(),
      save: jest.fn((input) => Promise.resolve(input as Reservation)),
      create: (input) =>
        ({ ...(input as object), id: 'res-id' }) as Reservation,
    };

    const courtRepo: jest.Mocked<Pick<Repository<Court>, 'findOne'>> = {
      findOne: jest.fn(),
    };

    const dataSource: DataSourceMock = {
      query: jest.fn(),
      transaction: jest.fn(),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Reservation), useValue: reservaRepo },
        { provide: getRepositoryToken(Court), useValue: courtRepo },
        { provide: NotificationEventsService, useValue: notificationEvents },
        // si tu service llama dispatch, tipalo mejor; por ahora alcanza
        { provide: NotificationsService, useValue: { dispatch: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get<ReservationsService>(ReservationsService);
  });

  it('creates a hold event when hold is created', async () => {
    const courtRepo = moduleRef.get<
      jest.Mocked<Pick<Repository<Court>, 'findOne'>>
    >(getRepositoryToken(Court));

    const dataSource = moduleRef.get<DataSourceMock>(DataSource);

    courtRepo.findOne.mockResolvedValue({
      id: 'court-id',
      activa: true,
      club: { id: 'club-id' },
      nombre: 'Court 1',
      superficie: 'cemento',
      precioPorHora: 100,
    } as unknown as Court);

    const reservationRepo: RepoMock<Reservation> & {
      create: (input: Partial<Reservation>) => Reservation;
    } = {
      findOne: jest.fn(),
      save: jest.fn((input) =>
        Promise.resolve(input as unknown as Reservation),
      ),
      create: (input) =>
        ({ ...(input as object), id: 'res-id' }) as Reservation,
    };

    dataSource.transaction.mockImplementation((cb) => {
      const trx: TransactionLike = {
        query: jest.fn((sql: string) => {
          if (sql.includes('SELECT now()')) {
            return Promise.resolve([{ now: new Date() }]);
          }
          return Promise.resolve([]);
        }),
        getRepository: jest.fn(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          (..._args: [typeof Reservation]) => reservationRepo,
        ),
      };

      return cb(trx);
    });

    await service.createHold({
      courtId: 'court-id',
      startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      clienteNombre: 'Test User',
      clienteEmail: null,
      clienteTelefono: null,
      precio: 100,
    });

    expect(notificationEvents.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationEventType.HOLD_CREATED,
        reservationId: 'res-id',
        channel: NotificationEventChannel.MOCK,
      }),
      expect.anything(),
    );
  });

  it('creates a reservation.confirmed event when confirming', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );
    const dataSource = moduleRef.get<DataSourceMock>(DataSource);

    dataSource.query.mockResolvedValue([{ now: new Date() }]);

    reservaRepo.findOne.mockResolvedValue({
      id: 'res-id',
      status: 'hold',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      court: { id: 'court-id', club: { id: 'club-id' } },
      startAt: new Date(),
      endAt: new Date(Date.now() + 60 * 60 * 1000),
      precio: 120,
      confirmedAt: null,
    } as unknown as Reservation);

    reservaRepo.save.mockImplementation((input) =>
      Promise.resolve(input as unknown as Reservation),
    );

    await service.confirm('res-id');

    expect(notificationEvents.recordEventIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationEventType.RESERVATION_CONFIRMED,
        reservationId: 'res-id',
        channel: NotificationEventChannel.MOCK,
      }),
    );
  });

  it('returns latest notification event with valid receipt token', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );
    const dataSource = moduleRef.get<DataSourceMock>(DataSource);

    dataSource.query.mockResolvedValue([{ now: new Date() }]);

    reservaRepo.findOne.mockResolvedValue({
      id: 'res-id',
      status: 'confirmed',
      receiptToken: 'receipt-123',
      receiptTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      checkoutToken: null,
    } as unknown as Reservation);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    notificationEvents.findLatestForReservation.mockResolvedValue({
      id: 'event-id',
      type: NotificationEventType.RESERVATION_CONFIRMED,
      reservationId: 'res-id',
      channel: NotificationEventChannel.MOCK,
      createdAt: new Date('2026-02-03T12:00:00.000Z'),
    } as unknown as any);

    const result = await service.getPublicNotifications(
      'res-id',
      'receipt-123',
    );

    expect(result).toEqual({
      id: 'event-id',
      type: NotificationEventType.RESERVATION_CONFIRMED,
      reservationId: 'res-id',
      channel: NotificationEventChannel.MOCK,
      createdAt: '2026-02-03T12:00:00.000Z',
    });
  });

  it('creates resend event and dispatches when token is valid', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );
    const dataSource = moduleRef.get<DataSourceMock>(DataSource);

    dataSource.query.mockResolvedValue([{ now: new Date() }]);

    reservaRepo.findOne.mockResolvedValue({
      id: 'res-id',
      status: 'confirmed',
      receiptToken: 'receipt-123',
      receiptTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      checkoutToken: null,
      court: { id: 'court-id', club: { id: 'club-id' } },
      startAt: new Date(),
      endAt: new Date(Date.now() + 60 * 60 * 1000),
      precio: 120,
      confirmedAt: new Date(),
    } as unknown as Reservation);

    notificationEvents.findLatestResendAfter.mockResolvedValue(null);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    notificationEvents.recordEvent.mockResolvedValue({
      id: 'event-id',
      type: NotificationEventType.NOTIFICATION_RESEND_REQUESTED,
      reservationId: 'res-id',
      channel: NotificationEventChannel.MOCK,
      createdAt: new Date('2026-02-03T12:05:00.000Z'),
    } as unknown as any);

    const result = await service.resendPublicNotification(
      'res-id',
      'receipt-123',
    );

    expect(notificationEvents.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationEventType.NOTIFICATION_RESEND_REQUESTED,
        reservationId: 'res-id',
        channel: NotificationEventChannel.MOCK,
      }),
    );

    expect(result).toEqual({
      idempotent: false,
      eventId: 'event-id',
      event: {
        id: 'event-id',
        type: NotificationEventType.NOTIFICATION_RESEND_REQUESTED,
        reservationId: 'res-id',
        channel: NotificationEventChannel.MOCK,
        createdAt: '2026-02-03T12:05:00.000Z',
      },
    });
  });

  it('rejects expired receipt token with 401', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );
    const dataSource = moduleRef.get<DataSourceMock>(DataSource);

    dataSource.query.mockResolvedValue([{ now: new Date() }]);

    reservaRepo.findOne.mockResolvedValue({
      id: 'res-id',
      status: 'confirmed',
      receiptToken: 'receipt-123',
      receiptTokenExpiresAt: new Date(Date.now() - 60 * 1000),
      checkoutToken: null,
    } as unknown as Reservation);

    await expect(
      service.getPublicNotifications('res-id', 'receipt-123'),
    ).rejects.toMatchObject({ status: 401 });
  });
});
