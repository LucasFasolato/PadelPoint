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

// Configuration
const TZ = 'America/Argentina/Cordoba';
const HOLD_MINUTES = 10;
const CHECKOUT_TOKEN_MINUTES = 30;

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
  ) {}

  // ---------------------------
  // TIME (single source of truth)
  // ---------------------------
  /**
   * Returns DB "now()" as a JS Date (UTC instant).
   * This avoids clock skew between app server and DB and aligns with SQL "now()".
   */
  private async getDbNow(trx?: any): Promise<Date> {
    const runner = trx ?? this.dataSource;
    const rows: Array<{ now: string | Date }> =
      await runner.query(`SELECT now() as now`);
    const v = rows?.[0]?.now;
    const dt =
      v instanceof Date
        ? DateTime.fromJSDate(v)
        : DateTime.fromISO(String(v), { setZone: true });

    if (!dt.isValid) {
      // fallback to app time if DB gave something unexpected (should not happen)
      return new Date();
    }
    return dt.toUTC().toJSDate();
  }

  private parseISO(iso: string): DateTime {
    const dt = DateTime.fromISO(iso, { setZone: true }); // respeta Z u offset
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

    // Validación "no pasado" basada en TZ negocio (ok)
    if (start < DateTime.now().setZone(TZ).minus({ minutes: 1 })) {
      throw new BadRequestException('No puedes reservar en el pasado');
    }

    return await this.dataSource.transaction(async (trx) => {
      // ✅ ServerNow desde DB (fuente de verdad)
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

      // 2) Overlaps (Existing Reservations)
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

      // 3) Prepare Data (desde DB now)
      const expiresAt = dbNowLux.plus({ minutes: HOLD_MINUTES }).toJSDate();

      const checkoutTokenExpiresAt = dbNowLux
        .plus({ minutes: CHECKOUT_TOKEN_MINUTES })
        .toJSDate();

      const checkoutToken = makeToken();

      // 4) Create Entity
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
        serverNow: dbNow.toISOString(), // ✅ DB now
      };
    });
  }

  // ---------------------------
  // INTERNAL ADMIN ACTIONS
  // ---------------------------
  async confirm(id: string) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException('Reserva cancelada');
    }
    if (res.status === ReservationStatus.CONFIRMED) return res;

    if (await this.isHoldExpired(res)) {
      throw new ConflictException('El hold expiró');
    }

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
      serverNow: dbNow.toISOString(), // ✅ DB now
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

    if (!token) throw new ForbiddenException('Token required');
    await this.assertCheckoutToken(res, token);

    return this.toPublicCheckout(res);
  }

  async confirmPublic(id: string, token: string) {
    // En confirm público usamos transacción para ser consistentes con dbNow
    return this.dataSource.transaction(async (trx) => {
      const repo = trx.getRepository(Reservation);

      const res = await repo.findOne({
        where: { id },
        relations: ['court', 'court.club'],
      });
      if (!res) throw new NotFoundException('Reserva no encontrada');

      await this.assertCheckoutToken(res, token, trx);

      if (res.status === ReservationStatus.CANCELLED) {
        throw new BadRequestException('Reserva cancelada');
      }

      if (res.status === ReservationStatus.CONFIRMED) {
        return this.toPublicCheckout(res, trx);
      }

      if (await this.isHoldExpired(res, trx)) {
        throw new ConflictException('El hold expiró');
      }

      res.status = ReservationStatus.CONFIRMED;
      res.expiresAt = null;
      res.checkoutTokenExpiresAt = null;
      res.confirmedAt = new Date();

      await repo.save(res);

      // ✅ devolvemos payload público completo para success sin re-fetch
      return this.toPublicCheckout(res, trx);
    });
  }
}
