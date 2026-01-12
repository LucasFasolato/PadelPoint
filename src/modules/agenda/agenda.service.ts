import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DateTime } from 'luxon';

import { Court } from '../courts/court.entity';
import {
  Reservation,
  ReservationStatus,
} from '../reservations/reservation.entity';
import { CourtAvailabilityOverride } from '../availability/court-availability-override.entity';

import { AgendaResponseDto, AgendaSlotStatus } from './dto/agenda-response.dto';
import { AgendaStatusMode, AgendaViewStatus } from './dto/agenda-query.dto';

const TZ = 'America/Argentina/Cordoba';

type SlotRow = {
  fecha: string;
  courtId: string;
  courtNombre: string;
  ts_inicio: string;
  ts_fin: string;
};

@Injectable()
export class AgendaService {
  constructor(
    @InjectRepository(Court)
    private readonly courtRepo: Repository<Court>,
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    @InjectRepository(CourtAvailabilityOverride)
    private readonly overrideRepo: Repository<CourtAvailabilityOverride>,
  ) {}

  async getDailyAgenda(params: {
    clubId: string;
    date: string;
    statuses?: string;
    mode: AgendaStatusMode;
  }): Promise<AgendaResponseDto> {
    const date = this.parseISODate(params.date);
    const dayStart = date.startOf('day');
    const dayEnd = date.endOf('day');

    const allowedViewStatuses = this.parseStatuses(params.statuses);

    const courts = await this.courtRepo.find({
      where: { club: { id: params.clubId }, activa: true } as any,
      order: { nombre: 'ASC' } as any,
      relations: ['club'],
    });

    const courtIds = courts.map((c) => c.id);
    if (courtIds.length === 0) {
      return { date: dayStart.toISODate()!, clubId: params.clubId, courts: [] };
    }

    const slots = await this.generateSlotsForClubOnDate(
      params.clubId,
      dayStart.toISODate(),
    );

    const slotsByCourt = new Map<
      string,
      Array<{ startAt: DateTime; endAt: DateTime }>
    >();
    for (const s of slots) {
      const start = DateTime.fromSQL(s.ts_inicio, { zone: TZ });
      const end = DateTime.fromSQL(s.ts_fin, { zone: TZ });
      const arr = slotsByCourt.get(s.courtId) ?? [];
      arr.push({ startAt: start, endAt: end });
      slotsByCourt.set(s.courtId, arr);
    }
    for (const [k, arr] of slotsByCourt) {
      arr.sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis());
      slotsByCourt.set(k, arr);
    }

    const overrides = await this.overrideRepo.find({
      where: {
        court: { id: In(courtIds) } as any,
        fecha: dayStart.toISODate() as any,
      } as any,
      relations: ['court'],
      order: { createdAt: 'DESC' } as any,
    });

    const now = DateTime.now().setZone(TZ).toJSDate();

    const reservations = await this.reservationRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.court', 'court')
      .where('r."courtId" IN (:...courtIds)', { courtIds })
      .andWhere('r."startAt" < :dayEnd', { dayEnd: dayEnd.toJSDate() })
      .andWhere('r."endAt" > :dayStart', { dayStart: dayStart.toJSDate() })
      .andWhere(
        `(r.status = :confirmed OR (r.status = :hold AND r."expiresAt" IS NOT NULL AND r."expiresAt" > :now))`,
        {
          confirmed: ReservationStatus.CONFIRMED,
          hold: ReservationStatus.HOLD,
          now,
        },
      )
      .orderBy('r."startAt"', 'ASC')
      .getMany();

    const overridesByCourt = groupBy(overrides, (o) => o.court.id);
    const reservationsByCourt = groupBy(reservations, (r) => r.court.id);

    return {
      date: dayStart.toISODate()!,
      clubId: params.clubId,
      courts: courts.map((c) => {
        const courtSlots = slotsByCourt.get(c.id) ?? [];
        const courtOv = overridesByCourt.get(c.id) ?? [];
        const courtRes = reservationsByCourt.get(c.id) ?? [];

        const fullSlots = courtSlots.map(({ startAt, endAt }) =>
          this.resolveSlotStatusFull({
            slotStart: startAt,
            slotEnd: endAt,
            overrides: courtOv,
            reservations: courtRes,
          }),
        );

        // convert full -> simple (occupied) if needed
        const shapedSlots =
          params.mode === 'simple'
            ? fullSlots.map((s) => this.toSimpleStatus(s))
            : fullSlots;

        // apply filter (free/blocked/occupied)
        const filteredSlots = allowedViewStatuses
          ? shapedSlots.filter((s) =>
              allowedViewStatuses.has(this.viewStatusOf(s.status)),
            )
          : shapedSlots;

        return {
          courtId: c.id,
          name: (c as any).nombre,
          slots: filteredSlots,
        };
      }),
    };
  }

  // ---------------------------
  // BLOCK endpoint (agenda)
  // ---------------------------
  async blockSlot(input: {
    clubId: string;
    courtId: string;
    date: string; // YYYY-MM-DD
    startTime: string; // HH:MM
    endTime: string; // HH:MM
    reason?: string;
    blocked: boolean;
  }) {
    const date = this.parseISODate(input.date).toISODate()!;

    // Validate court belongs to club + is active
    const court = await this.courtRepo.findOne({
      where: { id: input.courtId } as any,
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Court not found');
    if (court.club?.id !== input.clubId) {
      throw new BadRequestException('Court does not belong to this club');
    }
    if (!(court as any).activa) {
      throw new BadRequestException('Court is inactive');
    }

    if (
      this.timeToMinutes(input.endTime) <= this.timeToMinutes(input.startTime)
    ) {
      throw new BadRequestException('endTime must be greater than startTime');
    }

    const ent = this.overrideRepo.create({
      court,
      fecha: date as any,
      horaInicio: input.startTime as any,
      horaFin: input.endTime as any,
      bloqueado: input.blocked,
      motivo: input.reason?.trim() ?? null,
    });

    const saved = await this.overrideRepo.save(ent);
    return { ok: true, overrideId: saved.id };
  }

  async updateBlock(input: {
    clubId: string;
    overrideId: string;
    blocked: boolean;
    reason?: string;
  }) {
    const override = await this.overrideRepo.findOne({
      where: { id: input.overrideId } as any,
      relations: ['court', 'court.club'],
    });

    if (!override) throw new NotFoundException('Override not found');

    const courtClubId = (override as any).court?.club?.id;
    if (!courtClubId)
      throw new BadRequestException('Override has no club context');

    if (courtClubId !== input.clubId) {
      throw new BadRequestException('Override does not belong to this club');
    }

    override.bloqueado = input.blocked;
    if (input.reason !== undefined) {
      override.motivo = input.reason?.trim() || null;
    }

    await this.overrideRepo.save(override);

    return { ok: true, overrideId: override.id, blocked: override.bloqueado };
  }

  // ---------------------------
  // Status helpers
  // ---------------------------
  private viewStatusOf(status: string): AgendaViewStatus {
    if (status === 'blocked') return 'blocked';
    if (status === 'free') return 'free';
    // confirmed or hold => occupied
    return 'occupied';
  }

  private toSimpleStatus(slot: {
    startAt: string;
    endAt: string;
    status: AgendaSlotStatus;
    reservationId?: string;
    customerName?: string;
    customerPhone?: string;
    blockReason?: string;
  }) {
    const view = this.viewStatusOf(slot.status);
    const simpleStatus: AgendaSlotStatus =
      view === 'occupied' ? 'occupied' : view;

    return {
      ...slot,
      status: simpleStatus,
    };
  }

  private parseStatuses(raw?: string): Set<AgendaViewStatus> | null {
    if (!raw) return null;
    const parts = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const allowed: AgendaViewStatus[] = ['free', 'blocked', 'occupied'];

    const out = new Set<AgendaViewStatus>();
    for (const p of parts) {
      if (!allowed.includes(p as AgendaViewStatus)) {
        throw new BadRequestException(
          `Invalid statuses. Allowed: ${allowed.join(', ')}. Example: ?statuses=free,occupied`,
        );
      }
      out.add(p as AgendaViewStatus);
    }
    return out.size ? out : null;
  }

  private resolveSlotStatusFull(input: {
    slotStart: DateTime;
    slotEnd: DateTime;
    overrides: CourtAvailabilityOverride[];
    reservations: Reservation[];
  }) {
    const { slotStart, slotEnd, overrides, reservations } = input;

    const blocking = overrides.find((o) => {
      if (!o.bloqueado) return false;
      const oStart = DateTime.fromISO(`${o.fecha}T${o.horaInicio}`, {
        zone: TZ,
      });
      const oEnd = DateTime.fromISO(`${o.fecha}T${o.horaFin}`, { zone: TZ });
      return slotStart < oEnd && slotEnd > oStart;
    });

    if (blocking) {
      return {
        startAt: slotStart.toISO()!,
        endAt: slotEnd.toISO()!,
        status: 'blocked' as const,
        blockReason: blocking.motivo ?? undefined,
      };
    }

    const confirmed = reservations.find((r) => {
      if (r.status !== ReservationStatus.CONFIRMED) return false;
      const rStart = DateTime.fromJSDate(r.startAt).setZone(TZ);
      const rEnd = DateTime.fromJSDate(r.endAt).setZone(TZ);
      return slotStart < rEnd && slotEnd > rStart;
    });

    if (confirmed) {
      return {
        startAt: slotStart.toISO()!,
        endAt: slotEnd.toISO()!,
        status: 'confirmed' as const,
        reservationId: confirmed.id,
        customerName: confirmed.clienteNombre ?? undefined,
        customerPhone: confirmed.clienteTelefono ?? undefined,
      };
    }

    const hold = reservations.find((r) => {
      if (r.status !== ReservationStatus.HOLD) return false;
      if (!r.expiresAt || r.expiresAt.getTime() <= Date.now()) return false;
      const rStart = DateTime.fromJSDate(r.startAt).setZone(TZ);
      const rEnd = DateTime.fromJSDate(r.endAt).setZone(TZ);
      return slotStart < rEnd && slotEnd > rStart;
    });

    if (hold) {
      return {
        startAt: slotStart.toISO()!,
        endAt: slotEnd.toISO()!,
        status: 'hold' as const,
        reservationId: hold.id,
        customerName: hold.clienteNombre ?? undefined,
        customerPhone: hold.clienteTelefono ?? undefined,
      };
    }

    return {
      startAt: slotStart.toISO()!,
      endAt: slotEnd.toISO()!,
      status: 'free' as const,
    };
  }

  private timeToMinutes(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  private parseISODate(isoDate: string) {
    const dt = DateTime.fromISO(isoDate, { zone: TZ });
    if (!dt.isValid || !dt.toISODate())
      throw new BadRequestException('Invalid date');
    return dt;
  }

  private async generateSlotsForClubOnDate(
    clubId: string,
    dateISO: string,
  ): Promise<SlotRow[]> {
    const sql = `
      WITH d AS ( SELECT $1::date AS fecha ),
      rules AS (
        SELECT
          r."diaSemana",
          r."horaInicio",
          r."horaFin",
          r."slotMinutos",
          c.id AS "courtId",
          c.nombre AS "courtNombre"
        FROM "court_availability_rules" r
        JOIN "courts" c ON c.id = r."courtId"
        WHERE r.activo = true
          AND c.activa = true
          AND c."clubId" = $2::uuid
      ),
      base AS (
        SELECT d.fecha, ru."courtId", ru."courtNombre", ru."horaInicio", ru."horaFin", ru."slotMinutos"
        FROM d
        JOIN rules ru ON ru."diaSemana" = EXTRACT(DOW FROM d.fecha)::int
      ),
      slots AS (
        SELECT
          b.fecha::text AS fecha,
          b."courtId",
          b."courtNombre",
          (b.fecha::timestamp + (b."horaInicio"::time) + (gs.n * make_interval(mins => b."slotMinutos"))) AS ts_inicio,
          (b.fecha::timestamp + (b."horaInicio"::time) + ((gs.n + 1) * make_interval(mins => b."slotMinutos"))) AS ts_fin
        FROM base b
        JOIN LATERAL (
          SELECT generate_series(
            0,
            floor((EXTRACT(EPOCH FROM (b."horaFin"::time - b."horaInicio"::time)) / 60) / b."slotMinutos")::int - 1
          ) AS n
        ) gs ON true
      )
      SELECT
        s.fecha,
        s."courtId",
        s."courtNombre",
        s.ts_inicio::text AS ts_inicio,
        s.ts_fin::text AS ts_fin
      FROM slots s
      ORDER BY s.ts_inicio, s."courtNombre";
    `;

    return this.courtRepo.manager.query(sql, [dateISO, clubId]);
  }
}

function groupBy<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}
