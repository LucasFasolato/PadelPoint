// src/modules/reports/reports.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DateTime } from 'luxon';

import {
  Reservation,
  ReservationStatus,
} from '../reservations/reservation.entity';
import { Court } from '../courts/court.entity';

import { RevenueQueryDto } from './dto/revenue-query.dto';
import { RevenueReportDto } from './dto/revenue-response.dto';
import { OccupancyQueryDto } from './dto/occupancy-query.dto';
import { OccupancyReportDto } from './dto/occupancy-response.dto';
import { PeakHoursQueryDto } from './dto/peak-hours-query.dto';
import { PeakHoursReportDto } from './dto/peak-hours-response.dto';

import { SummaryQueryDto } from './dto/summary-query.dto';
import { SummaryResponseDto } from './dto/summary-response.dto';

const TZ = 'America/Argentina/Cordoba';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clampRangeDays(fromISO: string, toISO: string, maxDays = 366) {
  const f = new Date(fromISO + 'T00:00:00Z').getTime();
  const t = new Date(toISO + 'T00:00:00Z').getTime();
  if (Number.isNaN(f) || Number.isNaN(t))
    throw new BadRequestException('Invalid from/to date');
  const diffDays = Math.floor((t - f) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > maxDays) {
    throw new BadRequestException(
      `Date range too large (${diffDays} days). Max allowed: ${maxDays}.`,
    );
  }
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    @InjectRepository(Court)
    private readonly courtRepo: Repository<Court>,
  ) {}

  // -------------------
  // Existing helpers
  // -------------------
  private parseISODate(isoDate: string) {
    const dt = DateTime.fromISO(isoDate, { zone: TZ });
    if (!dt.isValid || !dt.toISODate())
      throw new BadRequestException('Invalid date');
    return dt;
  }

  private parseMonth(month: string) {
    const dt = DateTime.fromFormat(month, 'yyyy-MM', { zone: TZ });
    if (!dt.isValid)
      throw new BadRequestException('Invalid month format. Expected YYYY-MM');
    return dt;
  }

  // -------------------
  // Your existing reports (keep them as-is)
  // -------------------
  async revenueReport(q: RevenueQueryDto): Promise<RevenueReportDto> {
    clampRangeDays(q.from, q.to, 366);

    const from = this.parseISODate(q.from).startOf('day');
    const to = this.parseISODate(q.to).endOf('day');
    if (to < from) throw new BadRequestException('to must be >= from');

    const qb = this.reservationRepo
      .createQueryBuilder('r')
      .innerJoin('r.court', 'c')
      .where('c."clubId" = :clubId', { clubId: q.clubId })
      .andWhere('r.status = :status', { status: ReservationStatus.CONFIRMED })
      .andWhere('r."startAt" >= :from', { from: from.toJSDate() })
      .andWhere('r."startAt" <= :to', { to: to.toJSDate() });

    if ((q as any).courtId) {
      qb.andWhere('c.id = :courtId', { courtId: (q as any).courtId });
    }

    const rows = await qb
      .select('c.id', 'courtId')
      .addSelect('c.nombre', 'courtName')
      .addSelect('COUNT(*)::int', 'count')
      .addSelect('COALESCE(SUM(r.precio), 0)::numeric', 'revenue')
      .groupBy('c.id')
      .addGroupBy('c.nombre')
      .orderBy('revenue', 'DESC')
      .addOrderBy('count', 'DESC')
      .addOrderBy('c.nombre', 'ASC')
      .getRawMany<{
        courtId: string;
        courtName: string;
        count: number;
        revenue: string;
      }>();

    const byCourt = rows.map((x) => ({
      courtId: x.courtId,
      courtName: x.courtName,
      count: Number(x.count),
      revenue: Number(x.revenue),
    }));

    return {
      clubId: q.clubId,
      from: from.toISODate()!,
      to: to.toISODate()!,
      totalRevenue: byCourt.reduce((acc, x) => acc + x.revenue, 0),
      confirmedCount: byCourt.reduce((acc, x) => acc + x.count, 0),
      byCourt,
    };
  }

  async occupancyReport(q: OccupancyQueryDto): Promise<OccupancyReportDto> {
    const includeHolds = (q.includeHolds ?? 'false') === 'true';

    const monthStart = this.parseMonth(q.month).startOf('month').startOf('day');
    const monthEnd = this.parseMonth(q.month).endOf('month').endOf('day');

    const sql = `
      WITH days AS (
        SELECT gs::date AS fecha
        FROM generate_series($1::date, $2::date, interval '1 day') gs
      ),
      courts AS (
        SELECT c.id AS "courtId", c.nombre AS "courtName"
        FROM "courts" c
        WHERE c."clubId" = $3::uuid
          AND c.activa = true
      ),
      rules AS (
        SELECT
          r."courtId",
          r."diaSemana",
          r."horaInicio",
          r."horaFin",
          r."slotMinutos"
        FROM "court_availability_rules" r
        JOIN courts c ON c."courtId" = r."courtId"
        WHERE r.activo = true
      ),
      rule_windows AS (
        SELECT
          d.fecha,
          r."courtId",
          (d.fecha::timestamp + r."horaInicio"::time) AS win_start,
          (d.fecha::timestamp + r."horaFin"::time) AS win_end
        FROM days d
        JOIN rules r
          ON r."diaSemana" = EXTRACT(DOW FROM d.fecha)::int
      ),
      available AS (
        SELECT
          rw."courtId",
          SUM(EXTRACT(EPOCH FROM (rw.win_end - rw.win_start)) / 60)::int AS "availableMinutes"
        FROM rule_windows rw
        GROUP BY rw."courtId"
      ),
      blocked AS (
        SELECT
          rw."courtId",
          COALESCE(SUM(
            GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                LEAST(rw.win_end, (rw.fecha::timestamp + o."horaFin"::time))
                -
                GREATEST(rw.win_start, (rw.fecha::timestamp + o."horaInicio"::time))
              )) / 60
            )
          ), 0)::int AS "blockedMinutes"
        FROM rule_windows rw
        JOIN "court_availability_overrides" o
          ON o."courtId" = rw."courtId"
         AND o.fecha = rw.fecha
         AND o.bloqueado = true
         AND rw.win_start < (rw.fecha::timestamp + o."horaFin"::time)
         AND rw.win_end   > (rw.fecha::timestamp + o."horaInicio"::time)
        GROUP BY rw."courtId"
      ),
      reservations_in_scope AS (
        SELECT
          r.id,
          r."courtId",
          r.status,
          r."startAt",
          r."endAt",
          r."expiresAt"
        FROM "reservations" r
        JOIN courts c ON c."courtId" = r."courtId"
        WHERE r."startAt" < $2::timestamptz
          AND r."endAt" > $1::timestamptz
          AND (
            r.status = 'confirmed'
            OR (
              $4::boolean = true
              AND r.status = 'hold'
              AND r."expiresAt" IS NOT NULL
              AND r."expiresAt" > now()
            )
          )
      ),
      occupied AS (
        SELECT
          rw."courtId",
          COALESCE(SUM(
            GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                LEAST(rw.win_end, r."endAt")
                -
                GREATEST(rw.win_start, r."startAt")
              )) / 60
            )
          ), 0)::int AS "occupiedMinutes"
        FROM rule_windows rw
        JOIN reservations_in_scope r
          ON r."courtId" = rw."courtId"
         AND rw.win_start < r."endAt"
         AND rw.win_end   > r."startAt"
        GROUP BY rw."courtId"
      )
      SELECT
        c."courtId",
        c."courtName",
        COALESCE(a."availableMinutes", 0) AS "availableMinutes",
        COALESCE(b."blockedMinutes", 0) AS "blockedMinutes",
        COALESCE(o."occupiedMinutes", 0) AS "occupiedMinutes"
      FROM courts c
      LEFT JOIN available a ON a."courtId" = c."courtId"
      LEFT JOIN blocked b ON b."courtId" = c."courtId"
      LEFT JOIN occupied o ON o."courtId" = c."courtId"
      ORDER BY c."courtName";
    `;

    const monthStartISODate = monthStart.toISODate()!;
    const monthEndISODate = monthEnd.toISODate()!;

    const rows = await this.courtRepo.manager.query(sql, [
      monthStartISODate,
      monthEndISODate,
      q.clubId,
      includeHolds,
    ]);

    const byCourt = (rows as any[]).map((r) => {
      const availableMinutes = Number(r.availableMinutes ?? 0);
      const blockedMinutes = Number(r.blockedMinutes ?? 0);
      const occupiedMinutes = Number(r.occupiedMinutes ?? 0);

      const bookableMinutes = Math.max(0, availableMinutes - blockedMinutes);
      const occupancyPct =
        bookableMinutes === 0
          ? 0
          : round2((occupiedMinutes / bookableMinutes) * 100);

      return {
        courtId: String(r.courtId),
        courtName: String(r.courtName),
        availableMinutes,
        blockedMinutes,
        bookableMinutes,
        occupiedMinutes,
        occupancyPct,
      };
    });

    const totals = byCourt.reduce(
      (acc, c) => {
        acc.availableMinutes += c.availableMinutes;
        acc.blockedMinutes += c.blockedMinutes;
        acc.bookableMinutes += c.bookableMinutes;
        acc.occupiedMinutes += c.occupiedMinutes;
        return acc;
      },
      {
        availableMinutes: 0,
        blockedMinutes: 0,
        bookableMinutes: 0,
        occupiedMinutes: 0,
      },
    );

    const totalPct =
      totals.bookableMinutes === 0
        ? 0
        : round2((totals.occupiedMinutes / totals.bookableMinutes) * 100);

    return {
      clubId: q.clubId,
      month: q.month,
      totals: { ...totals, occupancyPct: totalPct },
      byCourt,
    };
  }

  async peakHoursReport(q: PeakHoursQueryDto): Promise<PeakHoursReportDto> {
    const includeHolds = (q.includeHolds ?? 'false') === 'true';
    const includeRevenue = (q.includeRevenue ?? 'true') === 'true';

    const monthStart = this.parseMonth(q.month).startOf('month').startOf('day');
    const monthEnd = this.parseMonth(q.month).endOf('month').endOf('day');

    const sql = `
      WITH courts AS (
        SELECT c.id AS "courtId"
        FROM "courts" c
        WHERE c."clubId" = $1::uuid
          AND c.activa = true
      ),
      res AS (
        SELECT
          r.id,
          r.status,
          r.precio,
          (r."startAt" AT TIME ZONE '${TZ}') AS start_local,
          r."expiresAt"
        FROM "reservations" r
        JOIN courts c ON c."courtId" = r."courtId"
        WHERE r."startAt" >= $2::timestamptz
          AND r."startAt" <= $3::timestamptz
          AND (
            r.status = 'confirmed'
            OR (
              $4::boolean = true
              AND r.status = 'hold'
              AND r."expiresAt" IS NOT NULL
              AND r."expiresAt" > now()
            )
          )
      )
      SELECT
        EXTRACT(DOW FROM start_local)::int AS dow,
        to_char(start_local, 'HH24:MI') AS time,
        COUNT(*)::int AS count,
        COALESCE(SUM(precio), 0)::numeric AS revenue
      FROM res
      GROUP BY 1, 2
      ORDER BY count DESC, revenue DESC, dow ASC, time ASC
      LIMIT 50;
    `;

    const rows = await this.courtRepo.manager.query(sql, [
      q.clubId,
      monthStart.toJSDate(),
      monthEnd.toJSDate(),
      includeHolds,
    ]);

    const weekdayLabel = (dow: number) =>
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow] ?? String(dow);

    const top = (rows as any[]).map((r) => ({
      dow: Number(r.dow),
      weekday: weekdayLabel(Number(r.dow)),
      time: String(r.time),
      count: Number(r.count ?? 0),
      revenue: includeRevenue ? Number(r.revenue ?? 0) : 0,
    }));

    const matrixMap = new Map<
      number,
      { dow: number; weekday: string; buckets: any[] }
    >();
    for (const b of top) {
      const entry = matrixMap.get(b.dow) ?? {
        dow: b.dow,
        weekday: b.weekday,
        buckets: [] as Array<{ time: string; count: number; revenue: number }>,
      };
      entry.buckets.push({ time: b.time, count: b.count, revenue: b.revenue });
      matrixMap.set(b.dow, entry);
    }

    const matrix = Array.from(matrixMap.values()).sort((a, b) => a.dow - b.dow);

    return { clubId: q.clubId, month: q.month, includeHolds, top, matrix };
  }

  // -------------------
  // ✅ NEW SUMMARY
  // -------------------
  async summaryReport(q: SummaryQueryDto): Promise<SummaryResponseDto> {
    const includeHolds = (q.includeHolds ?? 'false') === 'true';

    const m = this.parseMonth(q.month);
    const from = m.startOf('month').toISODate()!;
    const to = m.endOf('month').toISODate()!;

    const revenue = await this.revenueReport({
      clubId: q.clubId,
      from,
      to,
    } as any);

    const occupancy = await this.occupancyReport({
      clubId: q.clubId,
      month: q.month,
      includeHolds: includeHolds ? 'true' : 'false',
    });

    const peak = await this.peakHoursReport({
      clubId: q.clubId,
      month: q.month,
      includeHolds: includeHolds ? 'true' : 'false',
      includeRevenue: 'true',
    } as any);

    const topCourtByRevenue =
      revenue.byCourt.length > 0
        ? {
            courtId: revenue.byCourt[0].courtId,
            courtName: revenue.byCourt[0].courtName,
            value: revenue.byCourt[0].revenue,
          }
        : null;

    const topCourtByOccupancy = (() => {
      const sorted = [...occupancy.byCourt].sort(
        (a, b) => (b.occupancyPct ?? 0) - (a.occupancyPct ?? 0),
      );
      if (sorted.length === 0) return null;
      return {
        courtId: sorted[0].courtId,
        courtName: sorted[0].courtName,
        value: Number(sorted[0].occupancyPct ?? 0),
      };
    })();

    const topPeak = peak.top.length > 0 ? peak.top[0] : null;

    return {
      clubId: q.clubId,
      month: q.month,
      includeHolds,
      range: { from, to },

      revenue: {
        totalRevenue: revenue.totalRevenue,
        confirmedCount: revenue.confirmedCount,
        topCourtByRevenue,
      },

      occupancy: {
        availableMinutes: occupancy.totals.availableMinutes,
        blockedMinutes: occupancy.totals.blockedMinutes,
        bookableMinutes: occupancy.totals.bookableMinutes,
        occupiedMinutes: occupancy.totals.occupiedMinutes,
        occupancyPct: occupancy.totals.occupancyPct,
        topCourtByOccupancy,
      },

      peak: { top: topPeak },
    };
  }
}
