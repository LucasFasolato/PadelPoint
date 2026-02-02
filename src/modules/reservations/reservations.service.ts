import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { randomBytes, timingSafeEqual } from 'crypto';

import { Reservation, ReservationStatus } from './reservation.entity';
import { Court } from '../courts/court.entity';
import { CreateHoldDto } from './dto/create-hold.dto';
import { NotificationsService } from '@/notifications/notifications.service';

// Configuration
const TZ = 'America/Argentina/Cordoba';
const HOLD_MINUTES = 10;
const CHECKOUT_TOKEN_MINUTES = 30;
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

@Injectable()
export class ReservationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Reservation)
    private readonly reservaRepo: Repository<Reservation>,
    @InjectRepository(Court)
    private readonly courtRepo: Repository<Court>,
    private readonly notifications: NotificationsService,
  ) {}

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
          AND r.status IN ('hold','confirmed')
          AND (r.status = 'confirmed' OR (r.status = 'hold' AND r."expiresAt" > now()))
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

    // HOLD / CANCELLED => checkout token
    if (res.status !== ReservationStatus.CONFIRMED) {
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
  // RECEIPT ENDPOINT
  // ---------------------------
  private assertReceiptToken(res: Reservation, token: string): void {
    if (!token) throw new ForbiddenException('Receipt token required');
    if (!res.receiptToken)
      throw new ForbiddenException('Receipt token missing');

    if (res.receiptTokenExpiresAt) {
      const exp = DateTime.fromJSDate(res.receiptTokenExpiresAt).toMillis();
      if (exp <= Date.now())
        throw new ForbiddenException('Receipt token expired');
    }

    if (!safeEq(res.receiptToken, token)) {
      throw new ForbiddenException('Invalid receipt token');
    }
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

    if (!receiptToken) throw new ForbiddenException('Receipt token required');
    this.assertReceiptToken(res, receiptToken);

    return this.toPublicCheckout(res);
  }

  // ---------------------------
  // ADMIN + LISTS (sin cambios)
  // ---------------------------
  async confirm(id: string) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status === ReservationStatus.CANCELLED)
      throw new BadRequestException('Reserva cancelada');
    if (res.status === ReservationStatus.CONFIRMED) return res;

    if (await this.isHoldExpired(res))
      throw new ConflictException('El hold expiró');

    res.status = ReservationStatus.CONFIRMED;
    res.expiresAt = null;
    res.checkoutTokenExpiresAt = null;
    res.confirmedAt = new Date();
    return this.reservaRepo.save(res);
  }

  async cancel(id: string) {
    const res = await this.reservaRepo.findOne({ where: { id } });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status === ReservationStatus.CANCELLED) return res;

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
        `(r.status = :confirmed OR (r.status = :hold AND ( :includeExpired = true OR r."expiresAt" > now() )))`,
        {
          confirmed: ReservationStatus.CONFIRMED,
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
        `(r.status = :confirmed OR (r.status = :hold AND ( :includeExpired = true OR r."expiresAt" > now() )))`,
        {
          confirmed: ReservationStatus.CONFIRMED,
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
        `(r.status = :confirmed OR (r.status = :hold AND ( :includeExpired = true OR r."expiresAt" > now() )))`,
        {
          confirmed: ReservationStatus.CONFIRMED,
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
      SET status = 'cancelled',
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
