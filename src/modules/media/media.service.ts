import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { initCloudinary } from './cloudinary.client';

import { MediaAsset } from './media-asset.entity';
import { MediaOwnerType } from './media-owner-type.enum';
import { MediaKind } from './media-kind.enum';
import { MediaProvider } from './media-provider.enum';
import { RegisterMediaDto } from './dto/register-media.dto';
import { CreateSignatureDto } from './dto/create-signature.dto';

import { UserRole } from '../users/user-role.enum';
import { Court } from '../courts/court.entity';
import { ClubMemberRole } from '../club-members/enums/club-member-role.enum';
import { ClubMember } from '../club-members/club-member.entity';

type AuthUser = { userId: string; email: string; role: UserRole };

@Injectable()
export class MediaService {
  private readonly cloudinary = initCloudinary();

  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(MediaAsset)
    private readonly mediaRepo: Repository<MediaAsset>,

    @InjectRepository(Court)
    private readonly courtsRepo: Repository<Court>,

    @InjectRepository(ClubMember)
    private readonly clubMembersRepo: Repository<ClubMember>,
  ) {}

  private maxBytes(): number {
    const v = Number(process.env.MEDIA_MAX_BYTES ?? '5000000');
    return Number.isFinite(v) ? v : 5_000_000;
  }

  private allowedFormats(): Set<string> {
    const raw = (process.env.MEDIA_ALLOWED_FORMATS ?? 'jpg,jpeg,png,webp')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return new Set(raw);
  }

  private isSingleKind(kind: MediaKind): boolean {
    return (
      kind === MediaKind.CLUB_LOGO ||
      kind === MediaKind.CLUB_COVER ||
      kind === MediaKind.COURT_PRIMARY ||
      kind === MediaKind.USER_AVATAR
    );
  }

  private buildFolder(
    ownerType: MediaOwnerType,
    ownerId: string,
    kind: MediaKind,
  ) {
    // ordenado y estable
    return `padelpoint/${ownerType.toLowerCase()}/${ownerId}/${kind.toLowerCase()}`;
  }

  /**
   * Permisos:
   * - USER_AVATAR: solo el mismo usuario (o platform admin)
   * - CLUB_*: miembro del club (ADMIN o STAFF) o platform admin
   * - COURT_*: miembro del club dueño de la court (ADMIN o STAFF) o platform admin
   */
  private async assertMediaAccess(
    user: AuthUser,
    dto: { ownerType: MediaOwnerType; ownerId: string; kind: MediaKind },
  ) {
    if (user.role === UserRole.ADMIN) return; // platform admin

    if (dto.ownerType === MediaOwnerType.USER) {
      if (dto.ownerId !== user.userId)
        throw new ForbiddenException('Not allowed');
      return;
    }

    let clubId: string;

    if (dto.ownerType === MediaOwnerType.CLUB) {
      clubId = dto.ownerId;
    } else if (dto.ownerType === MediaOwnerType.COURT) {
      const court = await this.courtsRepo.findOne({
        where: { id: dto.ownerId },
        relations: ['club'],
      });
      if (!court) throw new BadRequestException('Court not found');
      clubId = court.club.id;
    } else {
      throw new BadRequestException('Invalid ownerType');
    }

    const membership = await this.clubMembersRepo.findOne({
      where: { userId: user.userId, clubId, active: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this club');

    // Para media, STAFF también puede (decisión producto). Si querés, podés limitar a ADMIN acá.
    if (
      ![ClubMemberRole.ADMIN, ClubMemberRole.STAFF].includes(membership.role)
    ) {
      throw new ForbiddenException('Insufficient club role');
    }
  }

  async createSignature(user: AuthUser, dto: CreateSignatureDto) {
    await this.assertMediaAccess(user, dto);

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = this.buildFolder(dto.ownerType, dto.ownerId, dto.kind);

    // Tip: public_id para single kinds, estable. Para gallery, agregamos hint + timestamp.
    const isSingle = this.isSingleKind(dto.kind);
    const basePublicId = isSingle
      ? `${folder}/main`
      : `${folder}/${dto.fileNameHint?.replace(/\s+/g, '-').toLowerCase() ?? 'img'}_${timestamp}`;

    // Parámetros firmados
    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder,
      public_id: basePublicId,
    };

    const signature = this.cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET as string,
    );

    return {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      folder,
      public_id: basePublicId,
      signature,
    };
  }

  async register(user: AuthUser, dto: RegisterMediaDto) {
    await this.assertMediaAccess(user, dto);

    // Validaciones de tamaño/formato (robustez)
    const maxBytes = this.maxBytes();
    if (typeof dto.bytes === 'number' && dto.bytes > maxBytes) {
      throw new BadRequestException(`File too large (max ${maxBytes} bytes)`);
    }

    const allowed = this.allowedFormats();
    if (dto.format) {
      const fmt = dto.format.toLowerCase();
      if (!allowed.has(fmt))
        throw new BadRequestException(`Format not allowed: ${fmt}`);
    }

    return this.dataSource.transaction(async (manager) => {
      const mediaRepo = manager.getRepository(MediaAsset);

      // Si es “single kind”, desactivamos lo anterior
      if (this.isSingleKind(dto.kind)) {
        await mediaRepo.update(
          {
            ownerType: dto.ownerType,
            ownerId: dto.ownerId,
            kind: dto.kind,
            active: true,
          },
          { active: false },
        );
      }

      const asset = mediaRepo.create({
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        kind: dto.kind,
        provider: MediaProvider.CLOUDINARY,
        publicId: dto.publicId,
        url: dto.url,
        secureUrl: dto.secureUrl,
        bytes: dto.bytes ?? null,
        format: dto.format ?? null,
        width: dto.width ?? null,
        height: dto.height ?? null,
        createdByUserId: user.userId,
        active: true,
      });

      return mediaRepo.save(asset);
    });
  }

  async list(ownerType: MediaOwnerType, ownerId: string, kind?: MediaKind) {
    const where: any = { ownerType, ownerId, active: true };
    if (kind) where.kind = kind;

    return this.mediaRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async remove(user: AuthUser, id: string) {
    const asset = await this.mediaRepo.findOne({ where: { id } });
    if (!asset) throw new BadRequestException('Media not found');

    await this.assertMediaAccess(user, {
      ownerType: asset.ownerType,
      ownerId: asset.ownerId,
      kind: asset.kind,
    });

    asset.active = false;
    return this.mediaRepo.save(asset);
  }

  async listPublic(
    ownerType: MediaOwnerType,
    ownerId: string,
    kind?: MediaKind,
  ) {
    // ⚠️ público: SOLO devuelve activos, no chequea permisos
    // si en el futuro querés ocultar USER avatars, lo filtramos acá.
    const where: Record<string, unknown> = { ownerType, ownerId, active: true };
    if (kind) where.kind = kind;

    return this.mediaRepo.find({
      where: where as any,
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'ownerType',
        'ownerId',
        'kind',
        'url',
        'secureUrl',
        'width',
        'height',
        'format',
        'createdAt',
      ],
    });
  }

  async getSinglePublic(
    ownerType: MediaOwnerType,
    ownerId: string,
    kind: MediaKind,
  ) {
    const asset = await this.mediaRepo.findOne({
      where: { ownerType, ownerId, kind, active: true },
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'ownerType',
        'ownerId',
        'kind',
        'url',
        'secureUrl',
        'width',
        'height',
        'format',
        'createdAt',
      ],
    });

    // no lo consideres error: devolver null es cómodo para frontend
    return asset ?? null;
  }
}
