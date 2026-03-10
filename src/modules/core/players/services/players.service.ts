import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import {
  DEFAULT_ELO,
  categoryFromElo,
} from '../../competitive/utils/competitive.constants';
import { Country } from '../../geo/entities/country.entity';
import { Province } from '../../geo/entities/province.entity';
import { City } from '../../geo/entities/city.entity';
import {
  PlayerLocation,
  PlayerLookingFor,
  PlayerProfile,
} from '../entities/player-profile.entity';
import { UpdatePlayerProfileDto } from '../dto/update-player-profile.dto';
import { PlayerFavorite } from '../entities/player-favorite.entity';
import {
  decodePlayerFavoritesCursor,
  encodePlayerFavoritesCursor,
  type PlayerFavoritesCursorPayload,
} from '../utils/player-favorites-cursor.util';

function defaultLookingFor(): PlayerLookingFor {
  return { partner: false, rival: false };
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

function normalizeGeoText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeGeoKey(value: string): string {
  return normalizeGeoText(value).toLocaleLowerCase('es-AR');
}

function toDisplayGeoName(value: string): string {
  const normalized = normalizeGeoText(value);
  if (!normalized) return normalized;
  return normalized
    .split(' ')
    .map((token) => {
      const lower = token.toLocaleLowerCase('es-AR');
      return lower.charAt(0).toLocaleUpperCase('es-AR') + lower.slice(1);
    })
    .join(' ');
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
    @InjectRepository(Country)
    private readonly countryRepo: Repository<Country>,
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    @InjectRepository(City)
    private readonly cityRepo: Repository<City>,
  ) {}

  async getMyProfile(userId: string) {
    const profile = await this.getOrCreateProfileEntity(userId);
    return this.toView(profile);
  }

  async updateMyProfile(userId: string, dto: UpdatePlayerProfileDto) {
    const user = await this.ensureUserExists(userId);
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
        if (Object.prototype.hasOwnProperty.call(dto.location, 'cityName')) {
          next.city = dto.location.cityName ?? null;
        }
        if (
          Object.prototype.hasOwnProperty.call(dto.location, 'provinceCode')
        ) {
          next.province = dto.location.provinceCode ?? null;
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

    const syncedCityId = await this.syncUserCityIdFromLocation(
      user,
      profile.location,
    );
    if (syncedCityId && user.cityId !== syncedCityId) {
      user.cityId = syncedCityId;
      await this.userRepo.save(user);
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

    const favorite = this.favoriteRepo.create({
      userId,
      favoriteUserId: targetUserId,
    });

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

  async listFavoriteIds(userId: string): Promise<{ ids: string[] }> {
    const rows = await this.favoriteRepo.find({
      where: { userId },
      select: { favoriteUserId: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 500,
    });

    return {
      ids: rows
        .map((row) => row.favoriteUserId)
        .filter(Boolean)
        .slice(0, 500),
    };
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

    const rows = await this.favoriteRepo.manager.query(
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
    );

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
    const nextCursor =
      hasMore && last
        ? encodePlayerFavoritesCursor({
            createdAt: new Date(last.createdAt).toISOString(),
            id: last.favoriteId,
          })
        : null;

    return { items, nextCursor };
  }

  private async getOrCreateProfileEntity(
    userId: string,
  ): Promise<PlayerProfile> {
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

  private async syncUserCityIdFromLocation(
    user: User,
    location: PlayerLocation | null | undefined,
  ): Promise<string | null> {
    const cityName = location?.city;
    const provinceInput = location?.province;
    if (
      typeof cityName !== 'string' ||
      cityName.trim().length === 0 ||
      typeof provinceInput !== 'string' ||
      provinceInput.trim().length === 0
    ) {
      return user.cityId ?? null;
    }

    const countryInput = location?.country;
    const country = await this.resolveCountryOrCreate(countryInput);
    const province = await this.resolveProvinceOrThrow(
      country.id,
      provinceInput,
    );
    const city = await this.upsertCity(province.id, cityName);
    return city.id;
  }

  private async resolveCountryOrCreate(countryInput?: string | null) {
    const raw =
      typeof countryInput === 'string' ? normalizeGeoText(countryInput) : '';
    const key =
      !raw ||
      ['ar', 'arg', 'argentina'].includes(raw.toLocaleLowerCase('es-AR'))
        ? 'argentina'
        : normalizeGeoKey(raw);

    let country = await this.countryRepo
      .createQueryBuilder('country')
      .where('LOWER(TRIM(country.name)) = :name', { name: key })
      .getOne();

    if (country) return country;

    const countryName =
      key === 'argentina' ? 'Argentina' : toDisplayGeoName(raw);
    country = this.countryRepo.create({ name: countryName });
    return this.countryRepo.save(country);
  }

  private async resolveProvinceOrThrow(
    countryId: string,
    provinceInput: string,
  ) {
    const normalized = normalizeGeoText(provinceInput);
    const provinceNameKey = normalizeGeoKey(normalized);
    const provinceCode =
      normalized.length <= 5
        ? normalized.toLocaleUpperCase('es-AR').replace(/\./g, '')
        : null;

    const qb = this.provinceRepo
      .createQueryBuilder('province')
      .where('province."countryId" = :countryId', { countryId })
      .andWhere('LOWER(TRIM(province.name)) = :provinceName', {
        provinceName: provinceNameKey,
      });

    if (provinceCode) {
      qb.orWhere(
        'province."countryId" = :countryId AND UPPER(TRIM(province.code)) = :provinceCode',
        { countryId, provinceCode },
      );
    }

    const province = await qb.getOne();
    if (!province) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PROVINCE_NOT_FOUND',
        message: 'Province not found for selected country',
      });
    }

    return province;
  }

  private async upsertCity(provinceId: string, cityName: string) {
    const normalizedName = normalizeGeoKey(cityName);
    let city = await this.cityRepo.findOne({
      where: { provinceId, normalizedName },
    });
    if (city) return city;

    city = this.cityRepo.create({
      provinceId,
      name: toDisplayGeoName(cityName),
      normalizedName,
    });

    try {
      return await this.cityRepo.save(city);
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
    }

    const reloaded = await this.cityRepo.findOne({
      where: { provinceId, normalizedName },
    });
    if (!reloaded) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'CITY_UPSERT_FAILED',
        message: 'Could not create city for selected province',
      });
    }
    return reloaded;
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
    const n = Math.trunc(limit);
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
