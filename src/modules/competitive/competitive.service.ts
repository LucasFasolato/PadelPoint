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
    const existing = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (existing) return this.toProfileView(existing);

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

    const saved = await this.profileRepo.save(created);
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
    const existing = await this.profileRepo.findOne({
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

    return this.profileRepo.save(created);
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
