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
const RECEIPT_TOKEN_MINUTES = 60 * 24 * 14; // 14 días

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
  /**
   * DB now() as UTC ISO string. This is the only time source for expiry logic.
   */
  private async getDbNowIso(trx?: any): Promise<string> {
    const runner = trx?.query ? trx : this.dataSource;
    const rows: Array<{ now: any }> =
      await runner.query(`SELECT now() as now;`);
    const v = rows?.[0]?.now;

    // pg may return Date or string depending on driver config
    const dt =
      v instanceof Date
        ? DateTime.fromJSDate(v)
        : DateTime.fromISO(String(v), { setZone: true });

    if (!dt.isValid) return new Date().toISOString(); // ultra fallback
    return dt.toUTC().toISO();
  }

  private parseISO(iso: string): DateTime {
    const dt = DateTime.fromISO(iso, { setZone: true }); // respeta Z u offset
    if (!dt.isValid) throw new BadRequestException('Fecha inválida');
    return dt.setZone(TZ);
  }

  // ---------------------------
  // TOKEN VALIDATORS (VALUE checks are app-side + timingSafe)
  // EXPIRY checks are DB-side (via SQL conditions or dbNow)
  // ---------------------------

  private assertTokenValue(
    stored: string | null,
    provided: string,
    msg: string,
  ) {
    if (!stored) throw new ForbiddenException(msg);
    if (!provided) throw new ForbiddenException(msg);
    if (!safeEq(stored, provided))
      throw new ForbiddenException('Invalid token');
  }

  private async assertCheckoutTokenActive(
    res: Reservation,
    token: string,
    trx?: any,
  ) {
    // value check
    this.assertTokenValue(
      res.checkoutToken ?? null,
      token,
      'Checkout token missing',
    );

    // expiry check with DB now
    const runner = trx?.query ? trx : this.dataSource;
    const rows = await runner.query(
      `
      SELECT 1
      FROM "reservations"
      WHERE id = $1::uuid
        AND "checkoutTokenExpiresAt" IS NOT NULL
        AND "checkoutTokenExpiresAt" > now()
      LIMIT 1;
      `,
      [res.id],
    );

    if (!rows.length) throw new ForbiddenException('Checkout token expired');
  }

  private async assertReceiptTokenActive(
    res: Reservation,
    token: string,
    trx?: any,
  ) {
    // value check
    this.assertTokenValue(
      res.receiptToken ?? null,
      token,
      'Receipt token missing',
    );

    // expiry check with DB now
    const runner = trx?.query ? trx : this.dataSource;
    const rows = await runner.query(
      `
      SELECT 1
      FROM "reservations"
      WHERE id = $1::uuid
        AND "receiptTokenExpiresAt" IS NOT NULL
        AND "receiptTokenExpiresAt" > now()
      LIMIT 1;
      `,
      [res.id],
    );

    if (!rows.length) throw new ForbiddenException('Receipt token expired');
  }

  // ---------------------------
  // PUBLIC SHAPE
  // ---------------------------

  private async toPublicCheckout(res: Reservation, trx?: any) {
    const serverNow = await this.getDbNowIso(trx);
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

    return {
      id: res.id,
      status: res.status,
      startAt: iso(res.startAt),
      endAt: iso(res.endAt),
      expiresAt: iso(res.expiresAt),
      precio: res.precio,

      checkoutTokenExpiresAt: iso(res.checkoutTokenExpiresAt),
      receiptToken: res.receiptToken ?? null,
      receiptTokenExpiresAt: iso(res.receiptTokenExpiresAt),

      serverNow, // ✅ DB now

      court: {
        id: res.court.id,
        nombre: (res.court as any).nombre,
        superficie: (res.court as any).superficie,
        precioPorHora: (res.court as any).precioPorHora,
        club: {
          id: (res.court as any).club.id,
          nombre: (res.court as any).club.nombre,
          direccion: (res.court as any).club.direccion,
        },
      },
      cliente: {
        nombre: res.clienteNombre,
        email: res.clienteEmail,
        telefono: res.clienteTelefono,
      },
    };
  }

  // ---------------------------
  // CREATE HOLD (DB-aligned time)
  // ---------------------------

  async createHold(dto: CreateHoldDto) {
    const court = await this.courtRepo.findOne({
      where: { id: dto.courtId },
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    if (!(court as any).activa)
      throw new BadRequestException('Cancha inactiva');

    const start = this.parseISO(dto.startAt);
    const end = this.parseISO(dto.endAt);

    if (end <= start) {
      throw new BadRequestException('endAt debe ser mayor a startAt');
    }

    // Validación “no pasado” basada en TZ negocio (ok)
    if (start < DateTime.now().setZone(TZ).minus({ minutes: 1 })) {
      throw new BadRequestException('No puedes reservar en el pasado');
    }

    return await this.dataSource.transaction(async (trx) => {
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

      // 2) Overlaps (Existing Reservations) usando DB now()
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

      // 3) Crear HOLD usando DB now() + interval (🔥 fija el skew)
      const checkoutToken = makeToken();

      const insertSql = `
        INSERT INTO "reservations" (
          "courtId",
          "startAt",
          "endAt",
          "status",
          "expiresAt",
          "checkoutToken",
          "checkoutTokenExpiresAt",
          "clienteNombre",
          "clienteEmail",
          "clienteTelefono",
          "precio"
        )
        VALUES (
          $1::uuid,
          $2::timestamptz,
          $3::timestamptz,
          'hold',
          now() + ($4::int * interval '1 minute'),
          $5::varchar,
          now() + ($6::int * interval '1 minute'),
          $7::varchar,
          $8::varchar,
          $9::varchar,
          $10::numeric
        )
        RETURNING
          id,
          status,
          "startAt",
          "endAt",
          "expiresAt",
          precio,
          "checkoutToken",
          now() as "serverNow";
      `;

      const rows = await trx.query(insertSql, [
        dto.courtId,
        start.toISO(),
        end.toISO(),
        HOLD_MINUTES,
        checkoutToken,
        CHECKOUT_TOKEN_MINUTES,
        normalizeText(dto.clienteNombre),
        dto.clienteEmail ? normalizeText(dto.clienteEmail) : null,
        dto.clienteTelefono ? normalizeText(dto.clienteTelefono) : null,
        Number(dto.precio),
      ]);

      const r = rows[0];

      return {
        id: r.id,
        status: r.status,
        startAt: new Date(r.startAt).toISOString(),
        endAt: new Date(r.endAt).toISOString(),
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
        precio: Number(r.precio),
        checkoutToken: r.checkoutToken,
        serverNow: new Date(r.serverNow).toISOString(),
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

    // Confirm admin: check hold active with DB now
    const ok = await this.dataSource.query(
      `
      SELECT 1
      FROM "reservations"
      WHERE id = $1::uuid
        AND status = 'hold'
        AND "expiresAt" IS NOT NULL
        AND "expiresAt" > now()
      LIMIT 1;
      `,
      [id],
    );
    if (!ok.length) throw new ConflictException('El hold expiró');

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

    await this.assertCheckoutTokenActive(res, token);

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
  // PUBLIC: GET CHECKOUT (HOLD/CANCELLED) via checkout token
  // ---------------------------

  async getPublicById(id: string, token: string | null) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court', 'court.club'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    // HOLD/CANCELLED => requiere checkout token
    if (res.status !== ReservationStatus.CONFIRMED) {
      if (!token) throw new ForbiddenException('Checkout token required');
      await this.assertCheckoutTokenActive(res, token);
      return this.toPublicCheckout(res);
    }

    // CONFIRMED => NO por checkout
    throw new ForbiddenException('Use receipt endpoint');
  }

  // ---------------------------
  // PUBLIC: CONFIRM (atomic DB-time check)
  // - validates checkout token active (db)
  // - confirms only if hold active (expiresAt > now())
  // - generates receipt token (14d) using DB now
  // - invalidates checkout token
  // ---------------------------

  async confirmPublic(id: string, token: string) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court', 'court.club'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    await this.assertCheckoutTokenActive(res, token);

    if (res.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException('Reserva cancelada');
    }

    // idempotente: si ya está confirmada, devolvemos receipt view (pero requiere receipt endpoint)
    // acá devolvemos el payload con receipt token si lo tiene; si no, lo generamos.
    return await this.dataSource.transaction(async (trx) => {
      // 🔥 Confirmación atómica: DB decide si el hold sigue vivo
      // Además: generamos receipt token + expiración con DB now()
      const newReceipt = makeToken();

      const upd = await trx.query(
        `
        UPDATE "reservations"
        SET
          status = 'confirmed',
          "expiresAt" = NULL,
          "confirmedAt" = now(),
          "receiptToken" = COALESCE("receiptToken", $2::varchar),
          "receiptTokenExpiresAt" = COALESCE("receiptTokenExpiresAt", now() + ($3::int * interval '1 minute')),
          "checkoutToken" = NULL,
          "checkoutTokenExpiresAt" = NULL
        WHERE id = $1::uuid
          AND status = 'hold'
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" > now()
          AND "checkoutTokenExpiresAt" IS NOT NULL
          AND "checkoutTokenExpiresAt" > now()
        RETURNING id;
        `,
        [id, newReceipt, RECEIPT_TOKEN_MINUTES],
      );

      if (!upd.length) {
        // distinguir causas con DB (no app time)
        const state = await trx.query(
          `
          SELECT status,
                 "expiresAt",
                 "checkoutTokenExpiresAt"
          FROM "reservations"
          WHERE id = $1::uuid
          LIMIT 1;
          `,
          [id],
        );

        if (!state.length) throw new NotFoundException('Reserva no encontrada');

        const row = state[0];

        // token expirado?
        if (!row.checkoutTokenExpiresAt)
          throw new ForbiddenException('Checkout token expired');
        const tokenOk = await trx.query(
          `SELECT 1 FROM "reservations" WHERE id=$1::uuid AND "checkoutTokenExpiresAt">now() LIMIT 1;`,
          [id],
        );
        if (!tokenOk.length)
          throw new ForbiddenException('Checkout token expired');

        // hold expirado?
        if (row.status === 'hold')
          throw new ConflictException('El hold expiró');

        // ya confirmada? -> devolvemos receipt (si existe) por receipt endpoint
        if (row.status === 'confirmed')
          throw new ConflictException('Ya confirmada');

        throw new ConflictException('No se pudo confirmar la reserva');
      }

      // Traer fresh y devolver payload público (incluye receipt token)
      const fresh = await trx.getRepository(Reservation).findOne({
        where: { id } as any,
        relations: ['court', 'court.club'],
      });
      if (!fresh) throw new NotFoundException('Reserva no encontrada');

      // 🔔 Notificaciones: disparar (no bloquear confirm)
      // (si querés robusto con outbox, lo hacemos después)
      try {
        await this.notifications.sendReservationConfirmedMock({
          reservationId: fresh.id,
        } as any);
      } catch {
        // swallow
      }

      return this.toPublicCheckout(fresh, trx);
    });
  }

  // ---------------------------
  // PUBLIC: RECEIPT (CONFIRMED) via receipt token
  // ---------------------------

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
    await this.assertReceiptTokenActive(res, receiptToken);

    return this.toPublicCheckout(res);
  }
}
