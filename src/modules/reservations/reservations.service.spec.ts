import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';

import { ReservationsService } from './reservations.service';
import { Reservation, ReservationStatus } from './reservation.entity';
import { Court } from '../courts/court.entity';

import { NotificationEventsService } from '@/notifications/notification-events.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { NotificationService } from '@/notifications/notification.service';
import {
  NotificationEventType,
  NotificationEventChannel,
} from '@/notifications/notification-event.entity';

type RepoMock<T> = {
  findOne: jest.Mock<Promise<T | null>, any>;
  findAndCount: jest.Mock<Promise<[T[], number]>, any>;
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
      findAndCount: jest.fn(),
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
        {
          provide: NotificationService,
          useValue: {
            sendReservationConfirmedEmail: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
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
      findAndCount: jest.fn(),
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

  it('paginates my reservations by email', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );

    reservaRepo.findAndCount.mockResolvedValue([
      [
        {
          id: 'res-1',
          status: 'confirmed',
          startAt: new Date('2026-02-03T10:00:00.000Z'),
          endAt: new Date('2026-02-03T11:00:00.000Z'),
          precio: 120,
          court: {
            id: 'court-1',
            nombre: 'Court 1',
            club: { id: 'club-1', nombre: 'Club 1' },
          },
        } as unknown as Reservation,
      ],
      12,
    ]);

    const result = await service.listMyReservations({
      email: 'player@test.com',
      page: 2,
      limit: 5,
    });

    expect(reservaRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clienteEmail: 'player@test.com' },
        take: 5,
        skip: 5,
        order: { startAt: 'DESC' },
      }),
    );

    expect(result).toEqual({
      items: [
        {
          reservationId: 'res-1',
          status: 'CONFIRMED',
          startAt: '2026-02-03T10:00:00.000Z',
          endAt: '2026-02-03T11:00:00.000Z',
          courtId: 'court-1',
          courtName: 'Court 1',
          clubId: 'club-1',
          clubName: 'Club 1',
          amount: 120,
        },
      ],
      total: 12,
      page: 2,
      limit: 5,
    });
  });

  it('creates receipt link for confirmed reservation', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );
    const dataSource = moduleRef.get<DataSourceMock>(DataSource);

    dataSource.query.mockResolvedValue([
      { now: new Date('2026-02-03T10:00:00.000Z') },
    ]);

    reservaRepo.findOne.mockResolvedValue({
      id: 'res-1',
      status: ReservationStatus.CONFIRMED,
      receiptToken: null,
      receiptTokenExpiresAt: null,
      clienteEmail: 'player@test.com',
    } as unknown as Reservation);

    const result = await service.createReceiptLinkForUser({
      reservationId: 'res-1',
      email: 'player@test.com',
    });

    expect(result.url).toContain('/checkout/success/res-1?receiptToken=');
  });

  it('returns 404 when reservation does not belong to player', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );
    reservaRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createReceiptLinkForUser({
        reservationId: 'res-404',
        email: 'player@test.com',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 409 when reservation is not confirmed', async () => {
    const reservaRepo = moduleRef.get<RepoMock<Reservation>>(
      getRepositoryToken(Reservation),
    );

    reservaRepo.findOne.mockResolvedValue({
      id: 'res-2',
      status: ReservationStatus.HOLD,
      clienteEmail: 'player@test.com',
    } as unknown as Reservation);

    await expect(
      service.createReceiptLinkForUser({
        reservationId: 'res-2',
        email: 'player@test.com',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
