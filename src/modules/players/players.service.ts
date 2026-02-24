import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { DEFAULT_ELO, categoryFromElo } from '../competitive/competitive.constants';
import {
  PlayerLocation,
  PlayerLookingFor,
  PlayerProfile,
} from './player-profile.entity';
import { UpdatePlayerProfileDto } from './dto/update-player-profile.dto';
import { PlayerFavorite } from './player-favorite.entity';
import {
  decodePlayerFavoritesCursor,
  encodePlayerFavoritesCursor,
  type PlayerFavoritesCursorPayload,
} from './player-favorites-cursor.util';

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
    @InjectRepository(PlayerFavorite)
    private readonly favoriteRepo: Repository<PlayerFavorite>,
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

  async addFavorite(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PLAYER_FAVORITE_SELF',
        message: 'Cannot favorite yourself',
      });
    }

    await this.ensureUserExists(targetUserId);

    const favorite = this.favoriteRepo.create({ userId, favoriteUserId: targetUserId });

    try {
      await this.favoriteRepo.save(favorite);
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
    }

    return { ok: true };
  }

  async removeFavorite(userId: string, targetUserId: string) {
    await this.favoriteRepo.delete({ userId, favoriteUserId: targetUserId });
    return { ok: true };
  }

  async listFavorites(
    userId: string,
    opts: { limit?: number; cursor?: string },
  ): Promise<{
    items: Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      elo: number;
      category: number;
      location: { city?: string; province?: string; country?: string } | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
  }> {
    const limit = this.normalizeFavoritesLimit(opts.limit);

    let cursor: PlayerFavoritesCursorPayload | null = null;
    if (opts.cursor) {
      try {
        cursor = decodePlayerFavoritesCursor(opts.cursor);
      } catch {
        throw new BadRequestException({
          statusCode: 400,
          code: 'PLAYER_FAVORITES_CURSOR_INVALID',
          message: 'Invalid favorites cursor',
        });
      }
    }

    const params: unknown[] = [userId];
    let cursorFilter = '';
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      cursorFilter = ` AND (f."createdAt", f.id) < ($2, $3)`;
    }
    params.push(limit + 1);
    const limitParam = cursor ? '$4' : '$2';

    const rows = (await this.favoriteRepo.manager.query(
      `
      SELECT
        f.id AS "favoriteId",
        f."favoriteUserId" AS "userId",
        f."createdAt" AS "createdAt",
        u."displayName" AS "displayName",
        cp.elo AS "elo",
        pp.location AS "location"
      FROM "player_favorites" f
      LEFT JOIN "users" u ON u.id = f."favoriteUserId"
      LEFT JOIN "competitive_profiles" cp ON cp."userId" = f."favoriteUserId"
      LEFT JOIN "player_profiles" pp ON pp."userId" = f."favoriteUserId"
      WHERE f."userId" = $1${cursorFilter}
      ORDER BY f."createdAt" DESC, f.id DESC
      LIMIT ${limitParam}
      `,
      params,
    )) as Array<{
      favoriteId: string;
      userId: string;
      createdAt: string | Date;
      displayName: string | null;
      elo: number | null;
      location: unknown;
    }>;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items = pageRows.map((row) => {
      const elo = Number.isFinite(Number(row.elo))
        ? Number(row.elo)
        : DEFAULT_ELO;
      const createdAt = new Date(row.createdAt).toISOString();

      return {
        userId: row.userId,
        displayName: row.displayName?.trim() || 'Player',
        avatarUrl: null,
        elo,
        category: categoryFromElo(elo),
        location: this.toFavoriteLocation(row.location),
        createdAt,
      };
    });

    const last = pageRows.at(-1);
    const nextCursor = hasMore && last
      ? encodePlayerFavoritesCursor({
          createdAt: new Date(last.createdAt).toISOString(),
          id: last.favoriteId,
        })
      : null;

    return { items, nextCursor };
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

  private normalizeFavoritesLimit(limit: number | undefined) {
    if (!Number.isFinite(limit)) return 20;
    const n = Math.trunc(limit as number);
    if (n < 1) return 1;
    if (n > 50) return 50;
    return n;
  }

  private toFavoriteLocation(value: unknown): {
    city?: string;
    province?: string;
    country?: string;
  } | null {
    if (!value) return null;

    let source = value;
    if (typeof value === 'string') {
      try {
        source = JSON.parse(value);
      } catch {
        return null;
      }
    }

    if (typeof source !== 'object' || source === null) return null;

    const record = source as Record<string, unknown>;
    const location: { city?: string; province?: string; country?: string } = {};

    if (typeof record.city === 'string' && record.city.length > 0) {
      location.city = record.city;
    }
    if (typeof record.province === 'string' && record.province.length > 0) {
      location.province = record.province;
    }
    if (typeof record.country === 'string' && record.country.length > 0) {
      location.country = record.country;
    }

    return Object.keys(location).length > 0 ? location : null;
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
