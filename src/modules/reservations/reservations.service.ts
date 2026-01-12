import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { Reservation, ReservationStatus } from './reservation.entity';
import { Court } from '../courts/court.entity';
import { CreateHoldDto } from './dto/create-hold.dto';

const TZ = 'America/Argentina/Cordoba';
const HOLD_MINUTES = 10;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Reservation)
    private readonly reservaRepo: Repository<Reservation>,
    @InjectRepository(Court) private readonly courtRepo: Repository<Court>,
  ) {}

  private parseISO(iso: string) {
    const dt = DateTime.fromISO(iso, { zone: TZ });
    if (!dt.isValid) throw new BadRequestException('Fecha inválida');
    return dt;
  }

  async createHold(dto: CreateHoldDto) {
    const court = await this.courtRepo.findOne({
      where: { id: dto.courtId },
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    if (!court.activa) throw new BadRequestException('Cancha inactiva');

    const start = this.parseISO(dto.startAt);
    const end = this.parseISO(dto.endAt);

    if (end <= start)
      throw new BadRequestException('endAt debe ser mayor a startAt');

    // 💡 regla comercial: no permitir holds en el pasado
    if (start < DateTime.now().setZone(TZ).minus({ minutes: 1 })) {
      throw new BadRequestException('No puedes reservar en el pasado');
    }

    return await this.dataSource.transaction(async (trx) => {
      // 1) Validar override (bloqueo)
      const overrideSql = `
        SELECT 1
        FROM "court_availability_overrides" o
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
      if (blocked.length)
        throw new ConflictException('Horario bloqueado por evento/torneo');

      // 2) Validar solapamiento con reservas existentes (CONFIRMED o HOLD vigente)
      const overlapSql = `
        SELECT 1
        FROM "reservations" r
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
      if (overlap.length) throw new ConflictException('Turno ocupado');

      const expiresAt = DateTime.now()
        .setZone(TZ)
        .plus({ minutes: HOLD_MINUTES })
        .toJSDate();

      const ent = trx.getRepository(Reservation).create({
        court,
        startAt: start.toJSDate(),
        endAt: end.toJSDate(),
        status: ReservationStatus.HOLD,
        expiresAt,
        clienteNombre: dto.clienteNombre.trim(),
        clienteEmail: dto.clienteEmail?.trim() ?? null,
        clienteTelefono: dto.clienteTelefono?.trim() ?? null,
        precio: Number(dto.precio),
      });

      return trx.getRepository(Reservation).save(ent);
    });
  }

  async confirm(id: string) {
    const res = await this.reservaRepo.findOne({
      where: { id },
      relations: ['court'],
    });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status === ReservationStatus.CANCELLED)
      throw new BadRequestException('Reserva cancelada');
    if (res.status === ReservationStatus.CONFIRMED) return res;

    // si el hold expiró, no se puede confirmar
    if (
      !res.expiresAt ||
      DateTime.fromJSDate(res.expiresAt).toMillis() <= Date.now()
    ) {
      throw new ConflictException('El hold expiró');
    }

    res.status = ReservationStatus.CONFIRMED;
    res.expiresAt = null;
    return this.reservaRepo.save(res);
  }

  async cancel(id: string) {
    const res = await this.reservaRepo.findOne({ where: { id } });
    if (!res) throw new NotFoundException('Reserva no encontrada');

    if (res.status === ReservationStatus.CANCELLED) return res;

    res.status = ReservationStatus.CANCELLED;
    res.expiresAt = null;
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
}
