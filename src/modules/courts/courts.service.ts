import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Court } from './court.entity';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { Club } from '../clubs/club.entity';

@Injectable()
export class CourtsService {
  constructor(
    @InjectRepository(Court) private courtRepo: Repository<Court>,
    @InjectRepository(Club) private clubRepo: Repository<Club>,
  ) {}

  async create(dto: CreateCourtDto) {
    const club = await this.clubRepo.findOne({ where: { id: dto.clubId } });
    if (!club) throw new NotFoundException('Club no encontrado');

    const dup = await this.courtRepo.findOne({
      where: { nombre: dto.nombre, club: { id: dto.clubId } },
    });
    if (dup)
      throw new ConflictException(
        'Ya existe una cancha con ese nombre en el club',
      );

    const court = this.courtRepo.create({
      nombre: dto.nombre.trim(),
      superficie: dto.superficie.trim(),
      precioPorHora: Number(dto.precioPorHora),
      activa: dto.activa ?? true,
      club,
    });

    return this.courtRepo.save(court);
  }

  async findAll() {
    return this.courtRepo.find({
      relations: ['club'],
      order: { nombre: 'ASC' },
    });
  }

  async findByClub(clubId: string) {
    return this.courtRepo.find({
      where: { club: { id: clubId } },
      order: { nombre: 'ASC' },
    });
  }

  async findOne(id: string) {
    const court = await this.courtRepo.findOne({
      where: { id },
      relations: ['club'],
    });
    if (!court) throw new NotFoundException('Cancha no encontrada');
    return court;
  }

  async update(id: string, dto: UpdateCourtDto) {
    const court = await this.findOne(id);

    if (dto.nombre !== undefined) court.nombre = dto.nombre.trim();
    if (dto.superficie !== undefined) court.superficie = dto.superficie.trim();
    if (dto.precioPorHora !== undefined)
      court.precioPorHora = Number(dto.precioPorHora);
    if (dto.activa !== undefined) court.activa = dto.activa;

    return this.courtRepo.save(court);
  }

  async remove(id: string) {
    const court = await this.findOne(id);
    await this.courtRepo.remove(court);
    return { ok: true };
  }
}
