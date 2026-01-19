import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Club } from './club.entity';
import { CreateClubDto } from './dto/create-club.dto';
import { UpdateClubDto } from './dto/update-club.dto';

import { ClubMember } from '../club-members/club-member.entity';
import { ClubMemberRole } from '../club-members/enums/club-member-role.enum';
import { User } from '../users/user.entity';

import { Court } from '../courts/court.entity';
import { MediaAsset } from '../media/media-asset.entity';
import { MediaOwnerType } from '../media/media-owner-type.enum';
import { MediaKind } from '../media/media-kind.enum';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
function normalizeText(s: string) {
  return s.trim();
}
function getPgErrorCode(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

@Injectable()
export class ClubsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Club) private readonly repo: Repository<Club>,
    @InjectRepository(Court) private readonly courtsRepo: Repository<Court>,
    @InjectRepository(MediaAsset)
    private readonly mediaRepo: Repository<MediaAsset>,
  ) {}

  // SOLO se llama desde ADMIN plataforma (controller lo protege)
  async create(dto: CreateClubDto) {
    const email = normalizeEmail(dto.email);
    const ownerEmail = normalizeEmail(dto.ownerEmail);

    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Ya existe un club con ese email');

    try {
      return await this.dataSource.transaction(async (manager) => {
        const clubRepo = manager.getRepository(Club);
        const userRepo = manager.getRepository(User);
        const clubMemberRepo = manager.getRepository(ClubMember);

        const owner = await userRepo.findOne({ where: { email: ownerEmail } });
        if (!owner) throw new NotFoundException('Owner user not found');

        if (!owner.active)
          throw new BadRequestException('Owner user is inactive');

        const club = clubRepo.create({
          nombre: normalizeText(dto.nombre),
          direccion: normalizeText(dto.direccion),
          telefono: normalizeText(dto.telefono),
          email,
          latitud: dto.latitud ?? null,
          longitud: dto.longitud ?? null,
          activo: dto.activo ?? true,
        });

        const savedClub = await clubRepo.save(club);

        // Asignar owner como ADMIN del club
        const membership = clubMemberRepo.create({
          userId: owner.id,
          clubId: savedClub.id,
          role: ClubMemberRole.ADMIN,
          active: true,
        });
        await clubMemberRepo.save(membership);

        return savedClub;
      });
    } catch (e: unknown) {
      if (getPgErrorCode(e) === '23505') {
        throw new ConflictException('Ya existe un club con ese email');
      }
      throw e;
    }
  }

  // Público (solo datos no sensibles)
  async findAllPublic() {
    return this.repo.find({
      where: { activo: true },
      order: { nombre: 'ASC' },
      // si querés ocultar email/telefono, usá select
      // select: ['id','nombre','direccion','latitud','longitud','activo','createdAt','updatedAt']
    });
  }

  async findOnePublic(id: string) {
    const club = await this.repo.findOne({ where: { id } });
    if (!club) throw new NotFoundException('Club no encontrado');
    if (!club.activo) throw new NotFoundException('Club no encontrado');
    return club;
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
    } catch (e: unknown) {
      if (getPgErrorCode(e) === '23505') {
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

  async getPublicOverview(clubId: string) {
    const club = await this.repo.findOne({ where: { id: clubId } });
    if (!club || !club.activo)
      throw new NotFoundException('Club no encontrado');

    const [logo, cover] = await Promise.all([
      this.mediaRepo.findOne({
        where: {
          ownerType: MediaOwnerType.CLUB,
          ownerId: clubId,
          kind: MediaKind.CLUB_LOGO,
          active: true,
        },
        order: { createdAt: 'DESC' },
      }),
      this.mediaRepo.findOne({
        where: {
          ownerType: MediaOwnerType.CLUB,
          ownerId: clubId,
          kind: MediaKind.CLUB_COVER,
          active: true,
        },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const courts = await this.courtsRepo.find({
      where: { club: { id: clubId } as any },
      relations: ['club'],
      order: { nombre: 'ASC' },
    });

    const courtIds = courts.map((c) => c.id);

    const primaryPhotos = courtIds.length
      ? await this.mediaRepo.find({
          where: {
            ownerType: MediaOwnerType.COURT,
            kind: MediaKind.COURT_PRIMARY,
            active: true,
            ownerId: courtIds as any,
          } as any,
          order: { createdAt: 'DESC' },
        })
      : [];

    const primaryByCourt = new Map<string, MediaAsset>();
    for (const p of primaryPhotos) {
      if (!primaryByCourt.has(p.ownerId)) primaryByCourt.set(p.ownerId, p);
    }

    return {
      club: {
        id: club.id,
        nombre: club.nombre,
        direccion: club.direccion,
        telefono: club.telefono,
        email: club.email,
        latitud: club.latitud,
        longitud: club.longitud,
        activo: club.activo,
      },
      media: {
        logo: logo ? { url: logo.url, secureUrl: logo.secureUrl } : null,
        cover: cover ? { url: cover.url, secureUrl: cover.secureUrl } : null,
      },
      courts: courts.map((c) => {
        const p = primaryByCourt.get(c.id);
        return {
          id: c.id,
          nombre: c.nombre,
          superficie: c.superficie,
          precioPorHora: c.precioPorHora,
          activa: c.activa,
          primaryPhoto: p ? { url: p.url, secureUrl: p.secureUrl } : null,
        };
      }),
    };
  }
}
