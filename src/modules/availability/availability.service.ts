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
import { BulkCreateAvailabilityDto } from './dto/bulk-create-availability.dto';
import { CreateAvailabilityRuleDto } from './dto/create-availability-rule.dto';
import { AvailabilityRangeQueryDto } from './dto/availability-range-query.dto';
import { CourtAvailabilityOverride } from './court-availability-override.entity';
import { CreateOverrideDto } from './dto/create-override.dto';
import { OverrideRangeQueryDto } from './dto/override-range-query.dto';

function timeToMinutes(hhmm: string) {
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

  async createRule(dto: CreateAvailabilityRuleDto) {
    const court = await this.courtRepo.findOne({
      where: { id: dto.courtId },
      relations: ['club'],
    });
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
        throw new ConflictException(
          'Ya existe una regla para esa cancha/día/horaInicio',
        );
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
      },
      relations: ['court'],
    });

    const existsKey = new Set(
      existentes.map((r) => `${r.diaSemana}|${r.horaInicio}`),
    );

    const toCreate = dias
      .filter((d) => !existsKey.has(`${d}|${dto.horaInicio}`))
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

  // Slots on-the-fly (por rango de fechas)
  async availabilityRange(q: AvailabilityRangeQueryDto) {
    clampRangeDays(q.from, q.to, 31);

    const from = q.from;
    const to = q.to;
    const clubId = q.clubId ?? null;
    const courtId = q.courtId ?? null;

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
            (
                EXTRACT(EPOCH FROM (b."horaFin"::time - b."horaInicio"::time)) / 60
            ) / b."slotMinutos"
            )::int - 1
        ) AS n
        ) gs ON true
    )
    SELECT
        s.fecha::text AS fecha,
        s."courtId",
        s."courtNombre",
        s."ruleId",
        to_char(s.ts_inicio, 'HH24:MI') AS "horaInicio",
        to_char(s.ts_fin, 'HH24:MI') AS "horaFin",

        (
        EXISTS (
            SELECT 1
            FROM "court_availability_overrides" o
            WHERE o.bloqueado = true
            AND o."courtId" = s."courtId"
            AND o.fecha = s.fecha
            AND s.ts_inicio::time < o."horaFin"
            AND s.ts_fin::time > o."horaInicio"
            AND ($4::uuid IS NULL OR o."courtId" = $4::uuid)
        )
        ) AS ocupado,

        (
        SELECT o.motivo
        FROM "court_availability_overrides" o
        WHERE o.bloqueado = true
            AND o."courtId" = s."courtId"
            AND o.fecha = s.fecha
            AND s.ts_inicio::time < o."horaFin"
            AND s.ts_fin::time > o."horaInicio"
            AND ($4::uuid IS NULL OR o."courtId" = $4::uuid)
        ORDER BY o."horaInicio"
        LIMIT 1
        ) AS "motivoBloqueo"

    FROM slots s
    ORDER BY s.fecha, s.ts_inicio, s."courtNombre";
    `;

    const rows = await this.dataSource.query(sql, [from, to, clubId, courtId]);

    return rows.map((r: any) => {
      const ocupado =
        r.ocupado === true || r.ocupado === 't' || r.ocupado === 1;

      return {
        fecha: r.fecha,
        courtId: r.courtId,
        courtNombre: r.courtNombre,
        ruleId: r.ruleId,
        horaInicio: r.horaInicio,
        horaFin: r.horaFin,
        ocupado,
        estado: ocupado ? 'ocupado' : 'libre',
        motivoBloqueo: r.motivoBloqueo ?? null,
      };
    });
  }

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

    // opcional: validar que court pertenezca al clubId si viene
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
      relations: ['court'],
    });
    if (!ent) throw new NotFoundException('Override no encontrado');
    await this.overrideRepo.remove(ent);
    return { ok: true };
  }
}
