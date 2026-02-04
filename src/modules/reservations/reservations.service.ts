import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { randomBytes, timingSafeEqual } from 'crypto';

import { Reservation, ReservationStatus } from './reservation.entity';
import { Court } from '../courts/court.entity';
import { CreateHoldDto } from './dto/create-hold.dto';
import { NotificationsService } from '@/notifications/notifications.service';
import {
  NotificationEventChannel,
  NotificationEventPayload,
  NotificationEventType,
  NotificationEvent,
} from '@/notifications/notification-event.entity';
import { NotificationEventsService } from '@/notifications/notification-events.service';
import { PublicNotificationEventDto } from './dto/public-notifications.dto';
import { NotificationService } from '@/notifications/notification.service';

// Configuration
const TZ = 'America/Argentina/Cordoba';
const HOLD_MINUTES = 10;
const CHECKOUT_TOKEN_MINUTES = 30;
const RESEND_WINDOW_MINUTES = 5;

type ReservationStatusContract =
  | 'HOLD'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED';
// const RECEIPT_TOKEN_MINUTES = 60 * 24 * 14; // 14 días

// Helpers
function normalizeText(s: string): string {
  return s.trim();
}

function makeToken(): string {
  return randomBytes(32).toString('hex');
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function normalizeReservationStatus(input: string): ReservationStatusContract {
  const raw = String(input ?? '').trim();
  if (!raw) return 'HOLD';

  if (
    raw === 'HOLD' ||
    raw === 'PAYMENT_PENDING' ||
    raw === 'CONFIRMED' ||
    raw === 'CANCELLED' ||
    raw === 'EXPIRED'
  ) {
    return raw;
  }

  switch (raw.toLowerCase()) {
    case 'hold':
      return 'HOLD';
    case 'payment_pending':
    case 'pending_payment':
      return 'PAYMENT_PENDING';
    case 'confirmed':
      return 'CONFIRMED';
    case 'cancelled':
    case 'canceled':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    default:
      // Safe fallback for unknown/legacy values.
      return 'HOLD';
  }
}

function isReceiptTokenValid(res: Reservation, now: Date): boolean {
  if (!res.receiptToken) return false;
  if (!res.receiptTokenExpiresAt) return true;
  return res.receiptTokenExpiresAt.getTime() > now.getTime();
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Reservation)
    private readonly reservaRepo: Repository<Reservation>,
    @InjectRepository(Court)
    private readonly courtRepo: Repository<Court>,
    private readonly notifications: NotificationsService,
    private readonly notificationEvents: NotificationEventsService,
    private readonly notificationService: NotificationService,
  ) {}

  private sendConfirmationNotification(res: Reservation) {
    // Fire and forget - no esperamos ni propagamos errores
    this.notificationService
      .sendReservationConfirmedEmail({
        reservationId: res.id,
        clienteEmail: res.clienteEmail,
        clienteNombre: res.clienteNombre,
        courtName: res.court.nombre,
        clubName: res.court.club.nombre,
        clubDireccion: res.court.club.direccion,
        startAt: res.startAt,
        endAt: res.endAt,
        precio: res.precio,
        receiptToken: res.receiptToken,
      })
      .catch((err) => {
        // Log pero no falla el flujo principal
        console.error('[NOTIFICATION ERROR]', err);
      });
  }

  // ---------------------------
  // TIME (single source of truth)
  // ---------------------------
  private async getDbNow(trx?: any): Promise<Date> {
    const runner = trx ?? this.dataSource;
    const rows: Array<{ now: string | Date }> =
      await runner.query(`SELECT now() as now`);
    const v = rows?.[0]?.now;
    const dt =
      v instanceof Date
        ? DateTime.fromJSDate(v)
        : DateTime.fromISO(String(v), { setZone: true });

    if (!dt.isValid) return new Date();
    return dt.toUTC().toJSDate();
  }

  private parseISO(iso: string): DateTime {
    const dt = DateTime.fromISO(iso, { setZone: true });
    if (!dt.isValid) throw new BadRequestException('Fecha inválida');
    return dt.setZone(TZ);
  }

  private async isHoldExpired(res: Reservation, trx?: any): Promise<boolean> {
    if (res.status !== ReservationStatus.HOLD) return false;
    if (!res.expiresAt) return true;
    const dbNow = await this.getDbNow(trx);
    return res.expiresAt.getTime() <= dbNow.getTime();
  }

  private async assertCheckoutToken(
    res: Reservation,
    token: string,
    trx?: any,
  ): Promise<void> {
    if (!token) throw new ForbiddenException('Token required');

    if (!res.checkoutToken || !res.checkoutTokenExpiresAt) {
      throw new ForbiddenException('Checkout token missing');
    }

    const dbNow = await this.getDbNow(trx);
    if (res.checkoutTokenExpiresAt.getTime() <= dbNow.getTime()) {
      throw new ForbiddenException('Checkout token expired');
    }

    if (!safeEq(res.checkoutToken, token)) {
      throw new ForbiddenException('Invalid token');
    }
  }

  private buildEventPayload(res: Reservation): NotificationEventPayload {
    return {
      reservationId: res.id,
      courtId: res.court.id,
      clubId: res.court.club.id,
      startAt: res.startAt.toISOString(),
      endAt: res.endAt.toISOString(),
      precio: res.precio,
      status: res.status,
      confirmedAt: res.confirmedAt ? res.confirmedAt.toISOString() : null,
    };
  }

  // ---------------------------
  // CREATE HOLD
  // ---------------------------
  async createHold(dto: CreateHoldDto) {
    const court = await this.courtRepo.findOne({
      where: { id: dto.courtId },
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    if (!court.activa) throw new BadRequestException('Cancha inactiva');

    const start = this.parseISO(dto.startAt);
    const end = this.parseISO(dto.endAt);

    if (end <= start) {
      throw new BadRequestException('endAt debe ser mayor a startAt');
    }

    if (start < DateTime.now().setZone(TZ).minus({ minutes: 1 })) {
      throw new BadRequestException('No puedes reservar en el pasado');
    }

    return await this.dataSource.transaction(async (trx) => {
      const dbNow = await this.getDbNow(trx);
      const dbNowLux = DateTime.fromJSDate(dbNow).toUTC();

      // 1) Overrides (Blocks)
      const overrideSql = `
        SELECT 1 FROM "court_availability_overrides" o
        WHERE o.bloqueado = true
          AND o."courtId" = $1::uuid
          AND o.fecha = ($2::timestamptz AT TIME ZONE '${TZ}')::date
          AND ($2::timestamptz)::time < o."horaFin"
          AND ($3::timestamptz)::time > o."horaInicio"
        LIMIT 1;
      `;
      const blocked = await trx.query(overrideSql, [
        dto.courtId,
        start.toISO(),
        end.toISO(),
      ]);
      if (blocked.length > 0) {
        throw new ConflictException('Horario bloqueado por evento/admin');
      }

      // 2) Overlaps
      const overlapSql = `
        SELECT 1 FROM "reservations" r
        WHERE r."courtId" = $1::uuid
          AND r.status IN ('hold','confirmed','payment_pending')
          AND (
            r.status = 'confirmed'
            OR r.status = 'payment_pending'
            OR (r.status = 'hold' AND r."expiresAt" > now())
          )
          AND r."startAt" < $3::timestamptz
          AND r."endAt" > $2::timestamptz
        LIMIT 1;
      `;
      const overlap = await trx.query(overlapSql, [
        dto.courtId,
        start.toISO(),
        end.toISO(),
      ]);
      if (overlap.length > 0) throw new ConflictException('Turno ocupado');

      // 3) Prepare data (desde DB now)
      const expiresAt = dbNowLux.plus({ minutes: HOLD_MINUTES }).toJSDate();
      const checkoutTokenExpiresAt = dbNowLux
        .plus({ minutes: CHECKOUT_TOKEN_MINUTES })
        .toJSDate();
      const checkoutToken = makeToken();

      // 4) Create
      const ent = trx.getRepository(Reservation).create({
        court,
        startAt: start.toJSDate(),
        endAt: end.toJSDate(),
        status: ReservationStatus.HOLD,
        expiresAt,
        checkoutToken,
        checkoutTokenExpiresAt,
        clienteNombre: normalizeText(dto.clienteNombre),
        clienteEmail: dto.clienteEmail ? normalizeText(dto.clienteEmail) : null,
        clienteTelefono: dto.clienteTelefono
          ? normalizeText(dto.clienteTelefono)
          : null,
        precio: Number(dto.precio),
      });

      const saved = await trx.getRepository(Reservation).save(ent);

      await this.notificationEvents.recordEvent(
        {
          type: NotificationEventType.HOLD_CREATED,
          reservationId: saved.id,
          userId: null,
          channel: NotificationEventChannel.MOCK,
          payload: this.buildEventPayload(saved),
        },
        trx,
      );

      return {
        id: saved.id,
        status: saved.status,
        startAt: saved.startAt.toISOString(),
        endAt: saved.endAt.toISOString(),
        expiresAt: saved.expiresAt?.toISOString() ?? null,
        precio: saved.precio,
        checkoutToken: saved.checkoutToken,
        serverNow: dbNow.toISOString(),
      };
    });
  }

  // ---------------------------
  // PUBLIC CHECKOUT HELPERS
  // ---------------------------
  private async toPublicCheckout(res: Reservation, trx?: any) {
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    const dbNow = await this.getDbNow(trx);

    return {
      id: res.id,
      status: res.status,
      startAt: iso(res.startAt),
      endAt: iso(res.endAt),
      expiresAt: iso(res.expiresAt),
      precio: res.precio,
      checkoutTokenExpiresAt: iso(res.checkoutTokenExpiresAt),
      serverNow: dbNow.toISOString(),

      receiptToken: res.receiptToken,
      receiptTokenExpiresAt: iso(res.receiptTokenExpiresAt),

      court: {
        id: res.court.id,
        nombre: res.court.nombre,
        superficie: res.court.superficie,
        precioPorHora: res.court.precioPorHora,
        club: {
          id: res.court.club.id,
          nombre: res.court.club.nombre,
          direccion: res.court.club.direccion,
        },
      },
      cliente: {
        nombre: res.clienteNombre,
        email: res.clienteEmail,
        telefono: res.clienteTelefono,
      },
    };
  }

  async getPublicById(id: string, token: string | null) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court', 'court.club'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    // HOLD / PAYMENT_PENDING => checkout token
    if (res.status !== ReservationStatus.CONFIRMED) {
      if (
        res.status === ReservationStatus.CANCELLED ||
        res.status === ReservationStatus.EXPIRED
      ) {
        throw new ConflictException('Reserva no disponible');
      }
      if (!token) throw new ForbiddenException('Checkout token required');
      await this.assertCheckoutToken(res, token);
      return this.toPublicCheckout(res);
    }

    // CONFIRMED no se expone aquí
    throw new ForbiddenException('Use receipt endpoint');
  }

  // ---------------------------
  // CONFIRM PUBLIC (ATÓMICO)
  // ---------------------------
  async confirmPublic(id: string, token: string) {
    if (!token) throw new ForbiddenException('Token required');

    return await this.dataSource.transaction(async (trx) => {
      // 1) Intento atómico: hold válido + token válido => confirmed
      const newReceipt = makeToken();

      // 14 días exactos usando interval en SQL (más simple y consistente)
      const sql = `
        UPDATE "reservations"
        SET
          status = 'confirmed',
          "expiresAt" = NULL,
          "confirmedAt" = now(),
          "receiptToken" = COALESCE("receiptToken", $3::text),
          "receiptTokenExpiresAt" = COALESCE("receiptTokenExpiresAt", now() + interval '14 days'),
          "checkoutToken" = NULL,
          "checkoutTokenExpiresAt" = NULL
        WHERE
          id = $1::uuid
          AND status = 'hold'
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" > now()
          AND "checkoutToken" = $2::text
          AND "checkoutTokenExpiresAt" IS NOT NULL
          AND "checkoutTokenExpiresAt" > now()
        RETURNING id;
      `;

      const updated: Array<{ id: string }> = await trx.query(sql, [
        id,
        token,
        newReceipt,
      ]);

      if (updated.length > 0) {
        // 2) Ya confirmada exitosamente => devolvemos payload público
        const res = await trx.getRepository(Reservation).findOne({
          where: { id } as any,
          relations: ['court', 'court.club'],
        });
        if (!res) throw new NotFoundException('Reserva no encontrada');

        // ✅ disparar notificaciones acá (idempotentes en tu NotificationsService)
        // (si todavía no lo conectaste, lo dejamos comentado)
        // await this.notifications.onReservationConfirmed(res);

        await this.notificationEvents.recordEventIfMissing(
          {
            type: NotificationEventType.RESERVATION_CONFIRMED,
            reservationId: res.id,
            userId: null,
            channel: NotificationEventChannel.MOCK,
            payload: this.buildEventPayload(res),
          },
          trx,
        );
        this.sendConfirmationNotification(res);
        return this.toPublicCheckout(res, trx);
      }

      // 3) Si no se actualizó, diagnosticamos el motivo con datos actuales
      const res = await trx.getRepository(Reservation).findOne({
        where: { id } as any,
        relations: ['court', 'court.club'],
      });
      if (!res) throw new NotFoundException('Reserva no encontrada');

      if (res.status === ReservationStatus.CANCELLED) {
        throw new BadRequestException('Reserva cancelada');
      }

      if (res.status === ReservationStatus.CONFIRMED) {
        // ya no aceptamos checkout token (se invalida al confirmar)
        throw new ForbiddenException('Use receipt endpoint');
      }
      if (res.status === ReservationStatus.PAYMENT_PENDING) {
        throw new ConflictException('Pago en proceso');
      }

      // status == hold: puede ser expirado o token inválido
      if (await this.isHoldExpired(res, trx)) {
        throw new ConflictException('El hold expiró');
      }

      // token inválido / expirado
      // (acá preferimos 403 para diferenciar de 409 expirado)
      await this.assertCheckoutToken(res, token, trx);

      // si pasó assert y aun así no updateó, sería rarísimo (race muy finita)
      throw new ConflictException('No se pudo confirmar. Reintenta.');
    });
  }

  // ---------------------------
  // RECEIPT TOKEN VALIDATION
  // ---------------------------
  private async assertReceiptTokenForReservation(
    res: Reservation,
    token: string,
    trx?: any,
  ): Promise<void> {
    if (!token) throw new UnauthorizedException('Receipt token required');

    if (res.checkoutToken && safeEq(res.checkoutToken, token)) {
      throw new ForbiddenException('Checkout token not allowed');
    }

    if (!res.receiptToken) {
      throw new UnauthorizedException('Receipt token missing');
    }

    const dbNow = await this.getDbNow(trx);
    if (
      res.receiptTokenExpiresAt &&
      res.receiptTokenExpiresAt.getTime() <= dbNow.getTime()
    ) {
      throw new UnauthorizedException('Receipt token expired');
    }

    if (safeEq(res.receiptToken, token)) return;

    const repository = trx ? trx.getRepository(Reservation) : this.reservaRepo;
    const other = await repository
      .createQueryBuilder('r')
      .select(['r.id'])
      .where('r.receiptToken = :token', { token })
      .andWhere(
        '(r."receiptTokenExpiresAt" IS NULL OR r."receiptTokenExpiresAt" > :dbNow)',
        { dbNow },
      )
      .andWhere('r.status = :status', {
        status: ReservationStatus.CONFIRMED,
      })
      .getOne();

    if (other) {
      throw new ForbiddenException('Receipt token does not match reservation');
    }

    throw new UnauthorizedException('Invalid receipt token');
  }

  private toPublicNotificationEvent(
    event: NotificationEvent,
  ): PublicNotificationEventDto {
    return {
      id: event.id,
      type: event.type,
      reservationId: event.reservationId,
      channel: event.channel,
      createdAt: event.createdAt.toISOString(),
    };
  }

  async getReceiptById(id: string, receiptToken: string | null) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court', 'court.club'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status !== ReservationStatus.CONFIRMED) {
      throw new ForbiddenException('Receipt available only for confirmed');
    }

    await this.assertReceiptTokenForReservation(res, receiptToken ?? '');

    return this.toPublicCheckout(res);
  }

  // ---------------------------
  // PUBLIC NOTIFICATIONS (receipt)
  // ---------------------------
  async getPublicNotifications(id: string, receiptToken: string) {
    const res = await this.reservaRepo.findOne({ where: { id } });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status !== ReservationStatus.CONFIRMED) {
      throw new ConflictException('Reserva no confirmada');
    }

    await this.assertReceiptTokenForReservation(res, receiptToken);

    const event = await this.notificationEvents.findLatestForReservation(
      res.id,
      [
        NotificationEventType.RESERVATION_CONFIRMED,
        NotificationEventType.NOTIFICATION_RESEND_REQUESTED,
      ],
    );

    if (!event) throw new NotFoundException('Evento no encontrado');

    return this.toPublicNotificationEvent(event);
  }

  async resendPublicNotification(id: string, receiptToken: string) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court', 'court.club'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status !== ReservationStatus.CONFIRMED) {
      throw new ConflictException('Reserva no confirmada');
    }

    await this.assertReceiptTokenForReservation(res, receiptToken);

    const dbNow = await this.getDbNow();
    const from = DateTime.fromJSDate(dbNow)
      .minus({ minutes: RESEND_WINDOW_MINUTES })
      .toJSDate();

    const existing = await this.notificationEvents.findLatestResendAfter(
      res.id,
      from,
    );

    if (existing) {
      return {
        idempotent: true,
        eventId: existing.id,
        event: this.toPublicNotificationEvent(existing),
      };
    }

    const created = await this.notificationEvents.recordEvent({
      type: NotificationEventType.NOTIFICATION_RESEND_REQUESTED,
      reservationId: res.id,
      userId: null,
      channel: NotificationEventChannel.MOCK,
      payload: this.buildEventPayload(res),
    });

    return {
      idempotent: false,
      eventId: created.id,
      event: this.toPublicNotificationEvent(created),
    };
  }

  // ---------------------------
  // ADMIN + LISTS (sin cambios)
  // ---------------------------
  async confirm(id: string) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court', 'court.club'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status === ReservationStatus.CANCELLED) {
      throw new ConflictException('Reserva cancelada');
    }
    if (res.status === ReservationStatus.EXPIRED) {
      throw new ConflictException('Reserva expirada');
    }
    if (res.status === ReservationStatus.CONFIRMED) return res;

    if (
      res.status === ReservationStatus.HOLD &&
      (await this.isHoldExpired(res))
    )
      throw new ConflictException('El hold expiró');

    res.status = ReservationStatus.CONFIRMED;
    res.expiresAt = null;
    res.checkoutTokenExpiresAt = null;
    res.confirmedAt = new Date();
    const saved = await this.reservaRepo.save(res);

    await this.notificationEvents.recordEventIfMissing({
      type: NotificationEventType.RESERVATION_CONFIRMED,
      reservationId: saved.id,
      userId: null,
      channel: NotificationEventChannel.MOCK,
      payload: this.buildEventPayload(saved),
    });
    this.sendConfirmationNotification(saved);
    return saved;
  }

  async cancel(id: string) {
    const res = await this.reservaRepo.findOne({ where: { id } });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status === ReservationStatus.CANCELLED) return res;
    if (res.status === ReservationStatus.EXPIRED)
      throw new ConflictException('Reserva expirada');
    if (res.status === ReservationStatus.CONFIRMED)
      throw new ConflictException('Reserva ya confirmada');

    res.status = ReservationStatus.CANCELLED;
    res.expiresAt = null;
    res.checkoutTokenExpiresAt = null;
    res.cancelledAt = new Date();
    return this.reservaRepo.save(res);
  }

  async getById(id: string) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');
    return res;
  }

  async listAll() {
    return this.reservaRepo.find({
      order: { createdAt: 'DESC' },
      relations: ['court'],
    });
  }

  async cancelPublic(id: string, token: string) {
    const res = await this.reservaRepo.findOne({ where: { id } });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    await this.assertCheckoutToken(res, token);

    if (res.status === ReservationStatus.CANCELLED) return res;
    if (res.status === ReservationStatus.EXPIRED)
      throw new ConflictException('Reserva expirada');
    if (res.status === ReservationStatus.CONFIRMED)
      throw new ConflictException('Reserva ya confirmada');

    res.status = ReservationStatus.CANCELLED;
    res.expiresAt = null;
    res.checkoutTokenExpiresAt = null;
    res.cancelledAt = new Date();
    return this.reservaRepo.save(res);
  }

  async listUserMatches(email: string) {
    const normalizedEmail = email.trim();
    return this.reservaRepo.find({
      where: { clienteEmail: normalizedEmail },
      relations: ['court', 'court.club'],
      order: { startAt: 'DESC' },
      take: 50,
    });
  }

  async listMyReservations(input: {
    email: string;
    page: number;
    limit: number;
  }) {
    // NOTE: We rely on clienteEmail association until Reservation has userId.
    const normalizedEmail = input.email.trim().toLowerCase();
    const page = Math.max(1, input.page);
    const limit = Math.min(50, Math.max(1, input.limit));
    const skip = (page - 1) * limit;

    const [rows, total] = await this.reservaRepo.findAndCount({
      where: { clienteEmail: normalizedEmail },
      relations: ['court', 'court.club'],
      order: { startAt: 'DESC' },
      take: limit,
      skip,
    });

    const items = rows.map((res) => ({
      reservationId: res.id,
      status: normalizeReservationStatus(res.status),
      startAt: res.startAt ? res.startAt.toISOString() : null,
      endAt: res.endAt ? res.endAt.toISOString() : null,
      courtId: res.court?.id ?? null,
      courtName: res.court?.nombre ?? null,
      clubId: res.court?.club?.id ?? null,
      clubName: res.court?.club?.nombre ?? null,
      amount: typeof res.precio === 'number' ? res.precio : null,
    }));

    return { items, total, page, limit };
  }

  async createReceiptLinkForUser(input: {
    reservationId: string;
    email: string;
  }) {
    const normalizedEmail = input.email.trim().toLowerCase();

    const res = await this.reservaRepo.findOne({
      where: { id: input.reservationId, clienteEmail: normalizedEmail },
    });

    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status !== ReservationStatus.CONFIRMED) {
      throw new ConflictException('El comprobante todavía no está disponible.');
    }

    const dbNow = await this.getDbNow();
    if (!isReceiptTokenValid(res, dbNow)) {
      const nextToken = makeToken();
      const expiresAt = DateTime.fromJSDate(dbNow)
        .toUTC()
        .plus({ days: 14 })
        .toJSDate();

      res.receiptToken = nextToken;
      res.receiptTokenExpiresAt = expiresAt;
      await this.reservaRepo.save(res);
    }

    return {
      url: `/checkout/success/${res.id}?receiptToken=${res.receiptToken}`,
    };
  }

  // ---------------------------
  // QUERY HELPERS
  // ---------------------------

  async listByClubRange(input: {
    clubId: string;
    from: string;
    to: string;
    status?: ReservationStatus;
    includeExpiredHolds?: boolean;
  }) {
    const { clubId, from, to, status, includeExpiredHolds } = input;
    const fromTs = new Date(from + 'T00:00:00.000Z');
    const toTs = new Date(to + 'T23:59:59.999Z');

    const qb = this.reservaRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.court', 'c')
      .leftJoin('c.club', 'club')
      .where('club.id = :clubId', { clubId })
      .andWhere('r.startAt < :toTs', { toTs })
      .andWhere('r.endAt > :fromTs', { fromTs })
      .orderBy('r.startAt', 'ASC');

    if (status) {
      qb.andWhere('r.status = :status', { status });
    } else {
      qb.andWhere(
        `(r.status = :confirmed OR r.status = :paymentPending OR (r.status = :hold AND ( :includeExpired = true OR r."expiresAt" > now() )))`,
        {
          confirmed: ReservationStatus.CONFIRMED,
          paymentPending: ReservationStatus.PAYMENT_PENDING,
          hold: ReservationStatus.HOLD,
          includeExpired: includeExpiredHolds ?? false,
        },
      );
    }
    return qb.getMany();
  }

  async listByCourtRange(input: {
    courtId: string;
    from: string;
    to: string;
    status?: ReservationStatus;
    includeExpiredHolds?: boolean;
  }) {
    const { courtId, from, to, status, includeExpiredHolds } = input;
    const fromTs = new Date(from + 'T00:00:00.000Z');
    const toTs = new Date(to + 'T23:59:59.999Z');

    const qb = this.reservaRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.court', 'c')
      .where('c.id = :courtId', { courtId })
      .andWhere('r.startAt < :toTs', { toTs })
      .andWhere('r.endAt > :fromTs', { fromTs })
      .orderBy('r.startAt', 'ASC');

    if (status) {
      qb.andWhere('r.status = :status', { status });
    } else {
      qb.andWhere(
        `(r.status = :confirmed OR r.status = :paymentPending OR (r.status = :hold AND ( :includeExpired = true OR r."expiresAt" > now() )))`,
        {
          confirmed: ReservationStatus.CONFIRMED,
          paymentPending: ReservationStatus.PAYMENT_PENDING,
          hold: ReservationStatus.HOLD,
          includeExpired: includeExpiredHolds ?? false,
        },
      );
    }
    return qb.getMany();
  }

  async listReservations(input: {
    clubId?: string;
    courtId?: string;
    from: string;
    to: string;
    status?: ReservationStatus;
    includeExpiredHolds?: boolean;
  }) {
    const { clubId, courtId, from, to, status, includeExpiredHolds } = input;

    if (!clubId && !courtId) {
      throw new BadRequestException('Must provide either clubId or courtId');
    }

    const fromTs = new Date(from + 'T00:00:00.000Z');
    const toTs = new Date(to + 'T23:59:59.999Z');

    const qb = this.reservaRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.court', 'c')
      .leftJoin('c.club', 'club')
      .where('r.startAt < :toTs', { toTs })
      .andWhere('r.endAt > :fromTs', { fromTs })
      .orderBy('r.startAt', 'ASC');

    if (clubId) qb.andWhere('club.id = :clubId', { clubId });
    if (courtId) qb.andWhere('c.id = :courtId', { courtId });

    if (status) {
      qb.andWhere('r.status = :status', { status });
    } else {
      qb.andWhere(
        `(r.status = :confirmed OR r.status = :paymentPending OR (r.status = :hold AND ( :includeExpired = true OR r."expiresAt" > now() )))`,
        {
          confirmed: ReservationStatus.CONFIRMED,
          paymentPending: ReservationStatus.PAYMENT_PENDING,
          hold: ReservationStatus.HOLD,
          includeExpired: includeExpiredHolds ?? false,
        },
      );
    }

    return qb.getMany();
  }

  // --------- EXPIRATION (cron) ---------

  async expireHoldsNow(limit = 500) {
    const sql = `
      UPDATE "reservations"
      SET status = 'expired',
          "expiresAt" = NULL,
          "checkoutTokenExpiresAt" = NULL,
          "cancelledAt" = now()
      WHERE id IN (
        SELECT id
        FROM "reservations"
        WHERE status = 'hold'
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" <= now()
        ORDER BY "expiresAt" ASC
        LIMIT $1
      )
      RETURNING id;
    `;
    const rows: Array<{ id: string }> = await this.dataSource.query(sql, [
      limit,
    ]);
    return { expiredCount: rows.length, ids: rows.map((r) => r.id) };
  }
}
