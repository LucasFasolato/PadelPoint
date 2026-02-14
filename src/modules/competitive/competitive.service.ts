import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UsersService } from '../users/users.service';
import { CompetitiveProfile } from './competitive-profile.entity';
import { EloHistory, EloHistoryReason } from './elo-history.entity';
import {
  DEFAULT_ELO,
  categoryFromElo,
  getStartEloForCategory,
} from './competitive.constants';
import { UpsertOnboardingDto } from './dto/upsert-onboarding.dto';

const COMPETITIVE_PROFILE_USER_REL_CONSTRAINT =
  'REL_6a6e2e2804aaf5d2fa7d83f8fa';

@Injectable()
export class CompetitiveService {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(CompetitiveProfile)
    private readonly profileRepo: Repository<CompetitiveProfile>,
    @InjectRepository(EloHistory)
    private readonly historyRepo: Repository<EloHistory>,
  ) {}

  async getOrCreateProfile(userId: string) {
    const saved = await this.getOrCreateProfileEntity(userId);
    return this.toProfileView(saved);
  }

  async initProfileCategory(userId: string, category: number) {
    const profile = await this.getOrCreateProfileEntity(userId);

    if (profile.matchesPlayed > 0 || profile.categoryLocked) {
      throw new BadRequestException(
        'Category cannot be changed after playing matches',
      );
    }

    const startElo = getStartEloForCategory(category);
    const before = profile.elo;

    profile.elo = startElo;
    profile.initialCategory = category;

    const saved = await this.profileRepo.save(profile);

    await this.historyRepo.save(
      this.historyRepo.create({
        profileId: saved.id,
        profile: saved,
        eloBefore: before,
        eloAfter: startElo,
        delta: startElo - before,
        reason: EloHistoryReason.INIT_CATEGORY,
        refId: null,
      }),
    );

    return this.toProfileView(saved);
  }

  async ranking(limit = 50) {
    const n = Math.max(1, Math.min(200, limit));

    const rows = await this.profileRepo.find({
      relations: ['user'],
      order: { elo: 'DESC', updatedAt: 'DESC' },
      take: n,
    });

    return rows.map((p) => ({
      userId: p.user.id,
      email: p.user.email,
      displayName: p.user.displayName,
      elo: p.elo,
      category: categoryFromElo(p.elo),
      matchesPlayed: p.matchesPlayed,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      updatedAt: p.updatedAt,
    }));
  }

  async eloHistory(userId: string, limit = 50) {
    const profile = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });

    if (!profile) {
      await this.getOrCreateProfile(userId);
      return [];
    }

    const n = Math.max(1, Math.min(200, limit));

    const rows = await this.historyRepo.find({
      where: { profileId: profile.id },
      order: { createdAt: 'DESC' },
      take: n,
    });

    return rows.map((h) => ({
      id: h.id,
      eloBefore: h.eloBefore,
      eloAfter: h.eloAfter,
      delta: h.delta,
      reason: h.reason,
      refId: h.refId,
      createdAt: h.createdAt,
    }));
  }

  // INTERNAL helper for EloService
  async getOrCreateProfileEntity(userId: string) {
    let existing = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (existing) return existing;

    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const created = this.profileRepo.create({
      userId: user.id,
      user,
      elo: DEFAULT_ELO,
      initialCategory: null,
      categoryLocked: false,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    });

    try {
      return await this.profileRepo.save(created);
    } catch (err: any) {
      const isDuplicate =
        String(err?.code) === '23505' &&
        String(err?.constraint) === COMPETITIVE_PROFILE_USER_REL_CONSTRAINT;
      if (!isDuplicate) throw err;
    }

    existing = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });

    if (!existing) {
      throw new NotFoundException('Competitive profile not found');
    }

    return existing;
  }

  async getOnboarding(userId: string) {
    const profile = await this.getOrCreateProfileEntity(userId);
    return this.toOnboardingView(profile);
  }

  async upsertOnboarding(userId: string, dto: UpsertOnboardingDto) {
    const profile = await this.getOrCreateProfileEntity(userId);

    if (dto.category !== undefined) {
      if (profile.matchesPlayed > 0 || profile.categoryLocked) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CATEGORY_LOCKED',
          message: 'Category cannot be changed after playing matches',
        });
      }

      const categoryChanged = dto.category !== profile.initialCategory;
      if (categoryChanged) {
        const startElo = getStartEloForCategory(dto.category);
        const before = profile.elo;

        profile.elo = startElo;
        profile.initialCategory = dto.category;

        await this.historyRepo.save(
          this.historyRepo.create({
            profileId: profile.id,
            profile,
            eloBefore: before,
            eloAfter: startElo,
            delta: startElo - before,
            reason: EloHistoryReason.INIT_CATEGORY,
            refId: null,
          }),
        );
      }
    }

    if (dto.primaryGoal !== undefined) {
      profile.primaryGoal = dto.primaryGoal;
    }

    if (dto.playingFrequency !== undefined) {
      profile.playingFrequency = dto.playingFrequency;
    }

    if (dto.preferences !== undefined) {
      profile.preferences = dto.preferences;
    }

    profile.onboardingComplete =
      profile.initialCategory != null &&
      profile.primaryGoal != null &&
      profile.playingFrequency != null;

    const saved = await this.profileRepo.save(profile);
    return this.toOnboardingView(saved);
  }

  private toOnboardingView(p: CompetitiveProfile) {
    return {
      userId: p.userId,
      category: categoryFromElo(p.elo),
      initialCategory: p.initialCategory,
      primaryGoal: p.primaryGoal,
      playingFrequency: p.playingFrequency,
      preferences: p.preferences,
      onboardingComplete: p.onboardingComplete,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private toProfileView(p: CompetitiveProfile) {
    return {
      userId: p.user.id,
      email: p.user.email,
      displayName: p.user.displayName,
      elo: p.elo,
      category: categoryFromElo(p.elo),
      initialCategory: p.initialCategory,
      categoryLocked: p.categoryLocked,
      matchesPlayed: p.matchesPlayed,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
    };
  }
}
