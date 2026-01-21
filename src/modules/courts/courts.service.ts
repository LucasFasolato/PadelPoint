import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Court } from './court.entity';
import { Club } from '../clubs/club.entity';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';

function normalizeText(s: string) {
  return s.trim();
}

@Injectable()
export class CourtsService {
  constructor(
    @InjectRepository(Court) private readonly repo: Repository<Court>,
    @InjectRepository(Club) private readonly clubsRepo: Repository<Club>,
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
}
