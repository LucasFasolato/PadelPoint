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
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../matches/match-result.entity';
import {
  DEFAULT_ELO,
  categoryFromElo,
  getStartEloForCategory,
} from './competitive.constants';
import { UpsertOnboardingDto } from './dto/upsert-onboarding.dto';

const COMPETITIVE_PROFILE_USER_REL_CONSTRAINT =
  'REL_6a6e2e2804aaf5d2fa7d83f8fa';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type MatchOutcome = 'W' | 'L';

type ProfileEngagementAggregates = {
  winStreakCurrent: number;
  winStreakBest: number;
  last10: MatchOutcome[];
  eloDelta30d: number;
  peakElo: number;
};

type MatchOutcomeRow = {
  id: string;
  playedAt: Date;
  winnerTeam: WinnerTeam;
  teamA1Id: string;
  teamA2Id: string | null;
  teamB1Id: string | null;
  teamB2Id: string | null;
};

type EloPointRow = {
  createdAt: Date;
  eloAfter: number;
};

@Injectable()
export class CompetitiveService {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(CompetitiveProfile)
    private readonly profileRepo: Repository<CompetitiveProfile>,
    @InjectRepository(EloHistory)
    private readonly historyRepo: Repository<EloHistory>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
  ) {}

  async getOrCreateProfile(userId: string) {
    const saved = await this.getOrCreateProfileEntity(userId);
    const aggregates = await this.getProfileEngagementAggregates(
      userId,
      saved.id,
      saved.elo,
    );
    return {
      ...this.toProfileView(saved),
      ...aggregates,
    };
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

  private async getProfileEngagementAggregates(
    userId: string,
    profileId: string,
    currentElo: number,
  ): Promise<ProfileEngagementAggregates> {
    const [allOutcomes, last10Outcomes, eloStats] = await Promise.all([
      this.getConfirmedMatchOutcomes(userId, 'ASC'),
      this.getConfirmedMatchOutcomes(userId, 'DESC', 10),
      this.getEloStats(profileId, currentElo),
    ]);

    let winStreakBest = 0;
    let runningWins = 0;
    for (const outcome of allOutcomes) {
      if (outcome === 'W') {
        runningWins += 1;
        if (runningWins > winStreakBest) {
          winStreakBest = runningWins;
        }
      } else {
        runningWins = 0;
      }
    }

    let winStreakCurrent = 0;
    for (let i = allOutcomes.length - 1; i >= 0; i--) {
      if (allOutcomes[i] !== 'W') break;
      winStreakCurrent += 1;
    }

    return {
      winStreakCurrent,
      winStreakBest,
      last10: last10Outcomes,
      eloDelta30d: eloStats.eloDelta30d,
      peakElo: eloStats.peakElo,
    };
  }

  private async getConfirmedMatchOutcomes(
    userId: string,
    order: 'ASC' | 'DESC',
    take?: number,
  ): Promise<MatchOutcome[]> {
    const qb = this.matchRepo
      .createQueryBuilder('m')
      .innerJoin('m.challenge', 'c')
      .select('m.id', 'id')
      .addSelect('m."playedAt"', 'playedAt')
      .addSelect('m."winnerTeam"', 'winnerTeam')
      .addSelect('c."teamA1Id"', 'teamA1Id')
      .addSelect('c."teamA2Id"', 'teamA2Id')
      .addSelect('c."teamB1Id"', 'teamB1Id')
      .addSelect('c."teamB2Id"', 'teamB2Id')
      .where('m.status = :status', { status: MatchResultStatus.CONFIRMED })
      .andWhere(
        '(c."teamA1Id" = :userId OR c."teamA2Id" = :userId OR c."teamB1Id" = :userId OR c."teamB2Id" = :userId)',
        { userId },
      )
      .orderBy('m."playedAt"', order)
      .addOrderBy('m.id', order);

    if (take) {
      qb.take(take);
    }

    const rows = await qb.getRawMany<MatchOutcomeRow>();
    const outcomes: MatchOutcome[] = [];
    for (const row of rows) {
      const outcome = this.resolveOutcomeForUser(row, userId);
      if (outcome) outcomes.push(outcome);
    }

    return outcomes;
  }

  private resolveOutcomeForUser(
    row: MatchOutcomeRow,
    userId: string,
  ): MatchOutcome | null {
    const isTeamA = row.teamA1Id === userId || row.teamA2Id === userId;
    const isTeamB = row.teamB1Id === userId || row.teamB2Id === userId;
    if (!isTeamA && !isTeamB) return null;

    const teamAWon = row.winnerTeam === WinnerTeam.A;
    const didWin = (isTeamA && teamAWon) || (isTeamB && !teamAWon);
    return didWin ? 'W' : 'L';
  }

  private async getEloStats(
    profileId: string,
    currentElo: number,
  ): Promise<{ eloDelta30d: number; peakElo: number }> {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

    const [latest, closestBefore, closestAfter, peakRaw] = await Promise.all([
      this.historyRepo
        .createQueryBuilder('h')
        .select('h."createdAt"', 'createdAt')
        .addSelect('h."eloAfter"', 'eloAfter')
        .where('h."profileId" = :profileId', { profileId })
        .orderBy('h."createdAt"', 'DESC')
        .addOrderBy('h.id', 'DESC')
        .limit(1)
        .getRawOne<EloPointRow | null>(),
      this.historyRepo
        .createQueryBuilder('h')
        .select('h."createdAt"', 'createdAt')
        .addSelect('h."eloAfter"', 'eloAfter')
        .where('h."profileId" = :profileId', { profileId })
        .andWhere('h."createdAt" <= :cutoff', { cutoff })
        .orderBy('h."createdAt"', 'DESC')
        .addOrderBy('h.id', 'DESC')
        .limit(1)
        .getRawOne<EloPointRow | null>(),
      this.historyRepo
        .createQueryBuilder('h')
        .select('h."createdAt"', 'createdAt')
        .addSelect('h."eloAfter"', 'eloAfter')
        .where('h."profileId" = :profileId', { profileId })
        .andWhere('h."createdAt" >= :cutoff', { cutoff })
        .orderBy('h."createdAt"', 'ASC')
        .addOrderBy('h.id', 'ASC')
        .limit(1)
        .getRawOne<EloPointRow | null>(),
      this.historyRepo
        .createQueryBuilder('h')
        .select('MAX(GREATEST(h."eloBefore", h."eloAfter"))', 'peakElo')
        .where('h."profileId" = :profileId', { profileId })
        .getRawOne<{ peakElo: string | null }>(),
    ]);

    let eloDelta30d = 0;
    if (latest) {
      const candidates: EloPointRow[] = [];
      if (closestBefore) candidates.push(closestBefore);
      if (closestAfter) candidates.push(closestAfter);

      if (candidates.length > 0) {
        let closest = candidates[0];
        let closestDistance = Math.abs(
          new Date(closest.createdAt).getTime() - cutoff.getTime(),
        );

        for (let i = 1; i < candidates.length; i++) {
          const candidate = candidates[i];
          const distance = Math.abs(
            new Date(candidate.createdAt).getTime() - cutoff.getTime(),
          );
          if (distance < closestDistance) {
            closest = candidate;
            closestDistance = distance;
          }
        }

        eloDelta30d = currentElo - Number(closest.eloAfter);
      }
    }

    const peakElo =
      peakRaw?.peakElo != null ? Number(peakRaw.peakElo) : currentElo;

    return { eloDelta30d, peakElo };
  }
}
