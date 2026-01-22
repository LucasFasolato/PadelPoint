import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config'; // Added ConfigService
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
  private readonly cloudinary;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService, // Injected ConfigService

    @InjectRepository(MediaAsset)
    private readonly mediaRepo: Repository<MediaAsset>,

    @InjectRepository(Court)
    private readonly courtsRepo: Repository<Court>,

    @InjectRepository(ClubMember)
    private readonly clubMembersRepo: Repository<ClubMember>,
  ) {
    // Correctly initialize Cloudinary using the validated configuration object
    const cloudinaryConfig = this.configService.get('cloudinary');
    this.cloudinary = initCloudinary(cloudinaryConfig);
  }

  private maxBytes(): number {
    return this.configService.get<number>('media.maxBytes');
  }

  private allowedFormats(): Set<string> {
    const raw = this.configService
      .get<string>('media.allowedFormats')
      .split(',')
      .map((s) => s.trim().toLowerCase());
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
    return `padelpoint/${ownerType.toLowerCase()}/${ownerId}/${kind.toLowerCase()}`;
  }

  private async assertMediaAccess(
    user: AuthUser,
    dto: { ownerType: MediaOwnerType; ownerId: string; kind: MediaKind },
  ) {
    if (user.role === UserRole.ADMIN) return;

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

    const isSingle = this.isSingleKind(dto.kind);
    const basePublicId = isSingle
      ? `${folder}/main`
      : `${folder}/${dto.fileNameHint?.replace(/\s+/g, '-').toLowerCase() ?? 'img'}_${timestamp}`;

    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder,
      public_id: basePublicId,
    };

    // Use the injected config to get the secret securely
    const apiSecret = this.configService.get('cloudinary.apiSecret');
    const signature = this.cloudinary.utils.api_sign_request(
      paramsToSign,
      apiSecret,
    );

    return {
      cloudName: this.configService.get('cloudinary.cloudName'),
      apiKey: this.configService.get('cloudinary.apiKey'),
      timestamp,
      folder,
      public_id: basePublicId,
      signature,
    };
  }

  async register(user: AuthUser, dto: RegisterMediaDto) {
    await this.assertMediaAccess(user, dto);

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

    return asset ?? null;
  }
}
