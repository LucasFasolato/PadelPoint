import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CourtAvailabilityRule } from './court-availability-rule.entity';
import { Court } from '../courts/court.entity';
import { CourtAvailabilityOverride } from './court-availability-override.entity';
import { CreateAvailabilityRuleDto } from './dto/create-availability-rule.dto';
import { BulkCreateAvailabilityDto } from './dto/bulk-create-availability.dto';
import { AvailabilityRangeQueryDto } from './dto/availability-range-query.dto';
import { CreateOverrideDto } from './dto/create-override.dto';
import { OverrideRangeQueryDto } from './dto/override-range-query.dto';

const TZ_DB = 'America/Argentina/Cordoba';

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function clampRangeDays(from: string, to: string, maxDays = 31) {
  const f = new Date(from + 'T00:00:00Z').getTime();
  const t = new Date(to + 'T00:00:00Z').getTime();
  if (Number.isNaN(f) || Number.isNaN(t)) return;
  const diffDays = Math.floor((t - f) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > maxDays) {
    throw new BadRequestException(
      `Rango demasiado grande (${diffDays} días). Máximo permitido: ${maxDays}.`,
    );
  }
}

export interface AvailabilitySlot {
  fecha: string;
  courtId: string;
  courtNombre: string;
  ruleId: string;
  horaInicio: string;
  horaFin: string;
  ocupado: boolean;
  estado: 'ocupado' | 'libre';
  motivoBloqueo: string | null;
  reservationId: string | null;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CourtAvailabilityRule)
    private readonly ruleRepo: Repository<CourtAvailabilityRule>,
    @InjectRepository(Court) private readonly courtRepo: Repository<Court>,
    @InjectRepository(CourtAvailabilityOverride)
    private readonly overrideRepo: Repository<CourtAvailabilityOverride>,
  ) {}

  // --- RULES MANAGEMENT ---
  async createRule(dto: CreateAvailabilityRuleDto) {
    const court = await this.courtRepo.findOne({ where: { id: dto.courtId } });
    if (!court) throw new NotFoundException('Cancha no encontrada');

    if (timeToMinutes(dto.horaFin) <= timeToMinutes(dto.horaInicio)) {
      throw new BadRequestException('horaFin debe ser mayor a horaInicio');
    }

    const ent = this.ruleRepo.create({
      court,
      diaSemana: dto.diaSemana,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      slotMinutos: dto.slotMinutos,
      activo: dto.activo ?? true,
    });

    try {
      return await this.ruleRepo.save(ent);
    } catch (e: any) {
      if (String(e?.code) === '23505')
        throw new ConflictException('Regla duplicada para esta cancha/día');
      throw e;
    }
  }

  async bulkCreate(dto: BulkCreateAvailabilityDto) {
    const court = await this.courtRepo.findOne({ where: { id: dto.courtId } });
    if (!court) throw new NotFoundException('Cancha no encontrada');

    if (timeToMinutes(dto.horaFin) <= timeToMinutes(dto.horaInicio)) {
      throw new BadRequestException('horaFin debe ser mayor a horaInicio');
    }

    const dias = Array.from(new Set(dto.diasSemana));
    const existentes = await this.ruleRepo.find({
      where: {
        court: { id: dto.courtId },
        diaSemana: In(dias),
        horaInicio: dto.horaInicio,
        horaFin: dto.horaFin,
        slotMinutos: dto.slotMinutos,
      },
    });

    const existsKey = new Set(
      existentes.map(
        (r) => `${r.diaSemana}|${r.horaInicio}|${r.horaFin}|${r.slotMinutos}`,
      ),
    );

    const toCreate = dias
      .filter(
        (d) =>
          !existsKey.has(
            `${d}|${dto.horaInicio}|${dto.horaFin}|${dto.slotMinutos}`,
          ),
      )
      .map((d) =>
        this.ruleRepo.create({
          court,
          diaSemana: d,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          slotMinutos: dto.slotMinutos,
          activo: dto.activo ?? true,
        }),
      );

    if (toCreate.length === 0) {
      return { inserted: 0, skipped: existentes.length };
    }

    const saved = await this.ruleRepo.save(toCreate);
    return {
      inserted: saved.length,
      skipped: existentes.length,
      created: saved,
    };
  }

  async listByCourt(courtId: string) {
    return this.ruleRepo.find({
      where: { court: { id: courtId } },
      relations: ['court'],
      order: { diaSemana: 'ASC', horaInicio: 'ASC' },
    });
  }

  // --- MAIN AVAILABILITY CALCULATION (SQL) ---
  async calculateAvailability(
    q: AvailabilityRangeQueryDto,
  ): Promise<AvailabilitySlot[]> {
    clampRangeDays(q.from, q.to, 31);

    const { from, to, clubId, courtId } = q;

    // Use parameterized query safe against injection, but interpolate constants like TZ
    const sql = `
    WITH dias AS (
      SELECT gs::date AS fecha
      FROM generate_series($1::date, $2::date, interval '1 day') gs
    ),
    rules AS (
      SELECT
        r.id AS "ruleId",
        r."diaSemana",
        r."horaInicio",
        r."horaFin",
        r."slotMinutos",
        c.id AS "courtId",
        c.nombre AS "courtNombre",
        c."clubId" AS "clubId"
      FROM "court_availability_rules" r
      JOIN "courts" c ON c.id = r."courtId"
      WHERE r.activo = true
        AND ($4::uuid IS NULL OR c.id = $4::uuid)
        AND ($3::uuid IS NULL OR c."clubId" = $3::uuid)
        AND c.activa = true
    ),
    base AS (
      SELECT
        d.fecha,
        ru."ruleId",
        ru."courtId",
        ru."courtNombre",
        ru."horaInicio",
        ru."horaFin",
        ru."slotMinutos"
      FROM dias d
      JOIN rules ru
        ON ru."diaSemana" = EXTRACT(DOW FROM d.fecha)::int
    ),
    slots AS (
      SELECT
        b.fecha,
        b."courtId",
        b."courtNombre",
        b."ruleId",
        (b.fecha::timestamp + (b."horaInicio"::time) + (gs.n * make_interval(mins => b."slotMinutos"))) AS ts_inicio,
        (b.fecha::timestamp + (b."horaInicio"::time) + ((gs.n + 1) * make_interval(mins => b."slotMinutos"))) AS ts_fin
      FROM base b
      JOIN LATERAL (
        SELECT generate_series(
          0,
          floor(
            (EXTRACT(EPOCH FROM (b."horaFin"::time - b."horaInicio"::time)) / 60) / b."slotMinutos"
          )::int - 1
        ) AS n
      ) gs ON true
    ),
    final AS (
      SELECT
        s.fecha,
        s."courtId",
        s."courtNombre",
        s."ruleId",
        to_char(s.ts_inicio, 'HH24:MI') AS "horaInicio",
        to_char(s.ts_fin, 'HH24:MI') AS "horaFin",
        (
          EXISTS (
            SELECT 1 FROM "court_availability_overrides" o
            WHERE o.bloqueado = true
              AND o."courtId" = s."courtId"
              AND o.fecha = s.fecha
              AND s.ts_inicio::time < o."horaFin"
              AND s.ts_fin::time > o."horaInicio"
          )
          OR
          EXISTS (
            SELECT 1 FROM "reservations" r
            WHERE r."courtId" = s."courtId"
              AND r.status IN ('hold','confirmed','payment_pending')
              AND (
                r.status = 'confirmed'
                OR r.status = 'payment_pending'
                OR (r.status = 'hold' AND r."expiresAt" > now())
              )
              AND r."startAt" < (s.ts_fin AT TIME ZONE '${TZ_DB}') 
              AND r."endAt" > (s.ts_inicio AT TIME ZONE '${TZ_DB}')
          )
        ) AS ocupado,
        (
          SELECT o.motivo FROM "court_availability_overrides" o
          WHERE o.bloqueado = true
            AND o."courtId" = s."courtId"
            AND o.fecha = s.fecha
            AND s.ts_inicio::time < o."horaFin"
            AND s.ts_fin::time > o."horaInicio"
          ORDER BY o."horaInicio" LIMIT 1
        ) AS "motivoBloqueo",
        (
          SELECT r.id FROM "reservations" r
          WHERE r."courtId" = s."courtId"
            AND r.status IN ('hold','confirmed','payment_pending')
            AND (
              r.status = 'confirmed'
              OR r.status = 'payment_pending'
              OR (r.status = 'hold' AND r."expiresAt" > now())
            )
            AND r."startAt" < (s.ts_fin AT TIME ZONE '${TZ_DB}')
            AND r."endAt" > (s.ts_inicio AT TIME ZONE '${TZ_DB}')
          ORDER BY r."createdAt" DESC LIMIT 1
        ) AS "reservationId"
      FROM slots s
    )
    SELECT DISTINCT ON ("courtId", fecha, "horaInicio", "horaFin")
      fecha::text AS fecha,
      "courtId",
      "courtNombre",
      "ruleId",
      "horaInicio",
      "horaFin",
      ocupado,
      "motivoBloqueo",
      "reservationId"
    FROM final
    ORDER BY
      "courtId",
      fecha,
      "horaInicio",
      "horaFin",
      "ruleId";
    `;

    // Type the raw result
    const rows = await this.dataSource.query(sql, [
      from,
      to,
      clubId || null,
      courtId || null,
    ]);

    // Explicitly map response to satisfy TypeScript
    return rows.map((r: any): AvailabilitySlot => {
      const isOccupied =
        r.ocupado === true || r.ocupado === 't' || r.ocupado === 1;

      return {
        fecha: r.fecha,
        courtId: r.courtId,
        courtNombre: r.courtNombre,
        ruleId: r.ruleId,
        horaInicio: r.horaInicio,
        horaFin: r.horaFin,
        ocupado: isOccupied,
        estado: isOccupied ? 'ocupado' : 'libre',
        motivoBloqueo: r.motivoBloqueo ?? null,
        reservationId: r.reservationId ?? null,
      };
    });
  }

  // --- OVERRIDES MANAGEMENT ---
  async createOverride(dto: CreateOverrideDto) {
    const court = await this.courtRepo.findOne({
      where: { id: dto.courtId },
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Cancha no encontrada');

    if (timeToMinutes(dto.horaFin) <= timeToMinutes(dto.horaInicio)) {
      throw new BadRequestException('horaFin debe ser mayor a horaInicio');
    }

    const ent = this.overrideRepo.create({
      court,
      fecha: dto.fecha,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      bloqueado: dto.bloqueado ?? true,
      motivo: dto.motivo?.trim() ?? null,
    });

    return await this.overrideRepo.save(ent);
  }

  async listOverrides(q: OverrideRangeQueryDto) {
    clampRangeDays(q.from, q.to, 62);

    if (q.clubId) {
      const court = await this.courtRepo.findOne({
        where: { id: q.courtId },
        relations: ['club'],
      });
      if (!court) throw new NotFoundException('Cancha no encontrada');
      if (court.club?.id !== q.clubId)
        throw new BadRequestException(
          'La cancha no pertenece al club indicado',
        );
    }

    // Use raw query for formatting
    const sql = `
      SELECT
        o.id,
        o."courtId",
        o.fecha::text AS fecha,
        to_char(o."horaInicio", 'HH24:MI') AS "horaInicio",
        to_char(o."horaFin", 'HH24:MI') AS "horaFin",
        o.bloqueado,
        o.motivo,
        o."createdAt"
      FROM "court_availability_overrides" o
      WHERE o."courtId" = $1::uuid
        AND o.fecha BETWEEN $2::date AND $3::date
      ORDER BY o.fecha, o."horaInicio";
    `;

    return await this.dataSource.query(sql, [q.courtId, q.from, q.to]);
  }

  async deleteOverride(id: string) {
    const ent = await this.overrideRepo.findOne({
      where: { id },
    });
    if (!ent) throw new NotFoundException('Override no encontrado');
    await this.overrideRepo.remove(ent);
    return { ok: true };
  }

  async cleanupDuplicates() {
    const sql = `
    WITH ranked AS (
      SELECT
        ctid,
        "courtId",
        "diaSemana",
        "horaInicio",
        "horaFin",
        "slotMinutos",
        ROW_NUMBER() OVER (
          PARTITION BY "courtId", "diaSemana", "horaInicio", "horaFin", "slotMinutos"
          ORDER BY "createdAt" DESC
        ) AS rn
      FROM "court_availability_rules"
    )
    DELETE FROM "court_availability_rules" r
    USING ranked x
    WHERE r.ctid = x.ctid
      AND x.rn > 1
    RETURNING 1;
  `;

    const rows = await this.dataSource.query(sql);
    return {
      message: 'Duplicate rules cleaned successfully',
      deleted: Array.isArray(rows) ? rows.length : 0,
    };
  }
}
