import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import {
  PlayerLocation,
  PlayerLookingFor,
  PlayerProfile,
} from './player-profile.entity';
import { UpdatePlayerProfileDto } from './dto/update-player-profile.dto';

function defaultLookingFor(): PlayerLookingFor {
  return { partner: false, rival: false };
}

function emptyLocation(): PlayerLocation {
  return { city: null, province: null, country: null };
}

function uniqueValues<T extends string>(values: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

@Injectable()
export class PlayersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PlayerProfile)
    private readonly profileRepo: Repository<PlayerProfile>,
  ) {}

  async getMyProfile(userId: string) {
    const profile = await this.getOrCreateProfileEntity(userId);
    return this.toView(profile);
  }

  async updateMyProfile(userId: string, dto: UpdatePlayerProfileDto) {
    const profile = await this.getOrCreateProfileEntity(userId);

    if (dto.bio !== undefined) {
      profile.bio = dto.bio ?? null;
    }

    if (dto.playStyleTags !== undefined) {
      profile.playStyleTags = dto.playStyleTags
        ? uniqueValues(dto.playStyleTags)
        : [];
    }

    if (dto.strengths !== undefined) {
      profile.strengths = dto.strengths ? uniqueValues(dto.strengths) : [];
    }

    if (dto.lookingFor !== undefined) {
      if (dto.lookingFor === null) {
        profile.lookingFor = defaultLookingFor();
      } else {
        const current = this.normalizeLookingFor(profile.lookingFor);
        profile.lookingFor = {
          partner: dto.lookingFor.partner ?? current.partner,
          rival: dto.lookingFor.rival ?? current.rival,
        };
      }
    }

    if (dto.location !== undefined) {
      if (dto.location === null) {
        profile.location = null;
      } else {
        const current = this.normalizeLocation(profile.location);
        const next: PlayerLocation = {
          city: current.city,
          province: current.province,
          country: current.country,
        };

        if (Object.prototype.hasOwnProperty.call(dto.location, 'city')) {
          next.city = dto.location.city ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(dto.location, 'province')) {
          next.province = dto.location.province ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(dto.location, 'country')) {
          next.country = dto.location.country ?? null;
        }

        const hasAnyValue = Object.values(next).some(
          (value) => typeof value === 'string' && value.length > 0,
        );
        profile.location = hasAnyValue ? next : null;
      }
    }

    const saved = await this.profileRepo.save(profile);
    return this.toView(saved);
  }

  private async getOrCreateProfileEntity(userId: string): Promise<PlayerProfile> {
    await this.ensureUserExists(userId);

    let profile = await this.profileRepo.findOne({ where: { userId } });
    if (profile) return profile;

    const created = this.profileRepo.create({
      userId,
      bio: null,
      playStyleTags: [],
      strengths: [],
      lookingFor: defaultLookingFor(),
      location: null,
    });

    try {
      return await this.profileRepo.save(created);
    } catch (error: any) {
      if (error?.code === '23505') {
        profile = await this.profileRepo.findOne({ where: { userId } });
        if (profile) return profile;
      }
      throw error;
    }
  }

  private async ensureUserExists(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private normalizeLookingFor(value: PlayerLookingFor | null | undefined) {
    return {
      partner: value?.partner ?? false,
      rival: value?.rival ?? false,
    };
  }

  private normalizeLocation(value: PlayerLocation | null | undefined) {
    return {
      city: value?.city ?? null,
      province: value?.province ?? null,
      country: value?.country ?? null,
    };
  }

  private toView(profile: PlayerProfile) {
    return {
      userId: profile.userId,
      bio: profile.bio ?? null,
      playStyleTags: Array.isArray(profile.playStyleTags)
        ? profile.playStyleTags
        : [],
      strengths: Array.isArray(profile.strengths) ? profile.strengths : [],
      lookingFor: this.normalizeLookingFor(profile.lookingFor),
      location: this.normalizeLocation(profile.location),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
