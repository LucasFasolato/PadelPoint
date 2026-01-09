import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Club } from './club.entity';
import { CreateClubDto } from './dto/create-club.dto';
import { UpdateClubDto } from './dto/update-club.dto';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
function normalizeText(s: string) {
  return s.trim();
}

@Injectable()
export class ClubsService {
  constructor(
    @InjectRepository(Club) private readonly repo: Repository<Club>,
  ) {}

  async create(dto: CreateClubDto) {
    const email = normalizeEmail(dto.email);

    // Chequeo previo (mejor error), además está protegido por unique index
    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Ya existe un club con ese email');

    const club = this.repo.create({
      nombre: normalizeText(dto.nombre),
      direccion: normalizeText(dto.direccion),
      telefono: normalizeText(dto.telefono),
      email,
      latitud: dto.latitud ?? null,
      longitud: dto.longitud ?? null,
      activo: dto.activo ?? true,
    });

    try {
      return await this.repo.save(club);
    } catch (e: any) {
      // Si dos requests llegan al mismo tiempo, puede saltar unique constraint
      if (String(e?.code) === '23505') {
        throw new ConflictException('Ya existe un club con ese email');
      }
      throw e;
    }
  }

  async findAll() {
    return this.repo.find({
      order: { nombre: 'ASC' },
    });
  }

  async findOne(id: string) {
    const club = await this.repo.findOne({ where: { id } });
    if (!club) throw new NotFoundException('Club no encontrado');
    return club;
  }

  async update(id: string, dto: UpdateClubDto) {
    const club = await this.findOne(id);

    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      if (email !== club.email) {
        const dup = await this.repo.findOne({ where: { email } });
        if (dup && dup.id !== club.id)
          throw new ConflictException('Ya existe un club con ese email');
        club.email = email;
      }
    }

    if (dto.nombre !== undefined) club.nombre = normalizeText(dto.nombre);
    if (dto.direccion !== undefined)
      club.direccion = normalizeText(dto.direccion);
    if (dto.telefono !== undefined) club.telefono = normalizeText(dto.telefono);
    if (dto.latitud !== undefined) club.latitud = dto.latitud ?? null;
    if (dto.longitud !== undefined) club.longitud = dto.longitud ?? null;
    if (dto.activo !== undefined) club.activo = dto.activo;

    try {
      return await this.repo.save(club);
    } catch (e: any) {
      if (String(e?.code) === '23505') {
        throw new ConflictException('Ya existe un club con ese email');
      }
      throw e;
    }
  }

  async remove(id: string) {
    const club = await this.findOne(id);
    await this.repo.remove(club);
    return { ok: true };
  }
}
