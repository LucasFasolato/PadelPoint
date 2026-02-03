import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { Court } from './court.entity';
import { Club } from '../clubs/club.entity';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import {
  Reservation,
  ReservationStatus,
} from '../reservations/reservation.entity';
import {
  startOfDay,
  endOfDay,
  addMinutes,
  format,
  parse,
  isBefore,
} from 'date-fns';

function normalizeText(s: string) {
  return s.trim();
}

@Injectable()
export class CourtsService {
  constructor(
    @InjectRepository(Court) private readonly repo: Repository<Court>,
    @InjectRepository(Club) private readonly clubsRepo: Repository<Club>,
    @InjectRepository(Reservation)
    private resRepo: Repository<Reservation>,
  ) {}

  async create(dto: CreateCourtDto) {
    const club = await this.clubsRepo.findOne({ where: { id: dto.clubId } });
    if (!club) throw new NotFoundException('Club no encontrado');
    if (!club.activo) throw new BadRequestException('Club inactivo');

    const court = this.repo.create({
      nombre: normalizeText(dto.nombre),
      superficie: normalizeText(dto.superficie),
      precioPorHora: dto.precioPorHora,
      activa: dto.activa ?? true,
      club,
    });

    return this.repo.save(court);
  }

  async findByClub(clubId: string) {
    return this.repo.find({
      where: { club: { id: clubId } },
      order: { nombre: 'ASC' },
    });
  }

  async findOne(id: string) {
    const court = await this.repo.findOne({
      where: { id },
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    return court;
  }

  async update(id: string, dto: UpdateCourtDto) {
    const court = await this.findOne(id);

    if (dto.nombre !== undefined) court.nombre = normalizeText(dto.nombre);
    if (dto.superficie !== undefined)
      court.superficie = normalizeText(dto.superficie);
    if (dto.precioPorHora !== undefined)
      court.precioPorHora = dto.precioPorHora;
    if (dto.activa !== undefined) court.activa = dto.activa;

    return this.repo.save(court);
  }

  async remove(id: string) {
    const court = await this.findOne(id);
    await this.repo.remove(court);
    return { ok: true };
  }

  // Públicos (solo canchas activas y clubes activos)
  async findByClubPublic(clubId: string) {
    return this.repo.find({
      where: {
        club: { id: clubId, activo: true },
        activa: true,
      },
      relations: ['club'],
      order: { nombre: 'ASC' },
    });
  }

  async findOnePublic(id: string) {
    const court = await this.repo.findOne({
      where: { id },
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    if (!court.activa || !court.club.activo)
      throw new NotFoundException('Cancha no encontrada');
    return court;
  }

  // THE AVAILABILITY ENGINE
  async getAvailability(clubId: string, dateString: string) {
    // 1. Get all active courts for this club
    const courts = await this.repo.find({
      where: { club: { id: clubId }, activa: true },
    });

    // 2. Get reservations for that specific date
    const date = parse(dateString, 'yyyy-MM-dd', new Date());
    const reservations = await this.resRepo.find({
      where: {
        court: { club: { id: clubId } },
        startAt: Between(startOfDay(date), endOfDay(date)),
      },
      relations: ['court'],
    });

    // 3. Define Club Hours (Hardcoded for now: 09:00 to 23:00)
    const openTime = 9;
    const closeTime = 23;
    const slotDuration = 60; // 60 minutes per match

    // 4. Generate slots for each court
    const availability = courts.map((court) => {
      const slots: string[] = [];
      let currentTime = startOfDay(date);
      currentTime = addMinutes(currentTime, openTime * 60); // Start at 09:00

      const closingTimeDate = startOfDay(date);
      // Set closing time
      const endTime = addMinutes(closingTimeDate, closeTime * 60);

      while (isBefore(currentTime, endTime)) {
        const slotStart = currentTime;
        const slotEnd = addMinutes(slotStart, slotDuration);

        // Check if this slot overlaps with any reservation
        const isBusy = reservations.some((res) => {
          if (res.court.id !== court.id) return false;
          const resStart = new Date(res.startAt);
          // Simple collision detection
          return resStart.getTime() === slotStart.getTime();
        });

        if (!isBusy) {
          slots.push(format(slotStart, 'HH:mm'));
        }

        currentTime = slotEnd;
      }

      return {
        courtId: court.id,
        courtName: court.nombre,
        surface: court.superficie,
        price: court.precioPorHora,
        availableSlots: slots,
      };
    });

    return availability;
  }

  async getSingleCourtAvailability(courtId: string, dateStr: string) {
    const date = new Date(dateStr); // Ensure this is local or UTC as needed

    // 1. Get existing reservations for this court on this date
    const reservations = await this.resRepo.find({
      where: {
        court: { id: courtId },
        // Simple date matching (improve for production timezones)
        startAt: Between(startOfDay(date), endOfDay(date)),
      },
    });

    // 2. Define Hours
    const openTime = 9;
    const closeTime = 23;
    const slots: any[] = [];

    let currentTime = startOfDay(date);
    currentTime = addMinutes(currentTime, openTime * 60); // 09:00
    const endTime = addMinutes(startOfDay(date), closeTime * 60); // 23:00

    // 3. Generate Slots matching your Interface
    while (isBefore(currentTime, endTime)) {
      const startStr = format(currentTime, 'HH:mm');
      const slotEnd = addMinutes(currentTime, 60);
      const endStr = format(slotEnd, 'HH:mm');

      // Check collision
      const isBusy = reservations.some((res) => {
        // Check if reservation overlaps this slot
        const resStart = new Date(res.startAt).getTime();
        return (
          resStart === currentTime.getTime() &&
          (res.status === ReservationStatus.CONFIRMED ||
            res.status === ReservationStatus.HOLD ||
            res.status === ReservationStatus.PAYMENT_PENDING)
        );
      });

      slots.push({
        courtId,
        fecha: dateStr,
        horaInicio: startStr,
        horaFin: endStr,
        ocupado: isBusy,
        estado: isBusy ? 'ocupado' : 'libre',
      });

      currentTime = slotEnd;
    }

    return slots;
  }
}
