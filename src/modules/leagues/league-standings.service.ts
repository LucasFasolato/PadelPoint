import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueStatus } from './league-status.enum';
import { LeagueMode } from './league-mode.enum';
import {
  MatchResult,
  MatchResultStatus,
} from '../matches/match-result.entity';
import { DEFAULT_LEAGUE_SETTINGS, LeagueSettings } from './league-settings.type';

@Injectable()
export class LeagueStandingsService {
  private readonly logger = new Logger(LeagueStandingsService.name);

  constructor(
    @InjectRepository(League)
    private readonly leagueRepo: Repository<League>,
    @InjectRepository(LeagueMember)
    private readonly memberRepo: Repository<LeagueMember>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
  ) {}

  /**
   * Called from MatchesService.confirmMatch() within the same transaction.
   * Finds all ACTIVE leagues affected by this match and recomputes standings.
   */
  async recomputeForMatch(
    manager: EntityManager,
    matchId: string,
  ): Promise<void> {
    const match = await manager
      .getRepository(MatchResult)
      .findOne({ where: { id: matchId }, relations: ['challenge'] });

    if (!match?.challenge) return;

    const ch = match.challenge;
    const playerIds = [ch.teamA1Id, ch.teamA2Id, ch.teamB1Id, ch.teamB2Id];
    if (playerIds.some((id) => !id)) return;

    // Find ACTIVE leagues where ALL 4 players are members
    // For SCHEDULED: match playedAt must fall within [startDate, endDate]
    // For OPEN: no date restriction
    const qb = manager
      .getRepository(League)
      .createQueryBuilder('l')
      .where('l.status = :status', { status: LeagueStatus.ACTIVE })
      .andWhere(
        '(l.mode = :open OR (l."startDate" <= :playedAt AND l."endDate" >= :playedAt))',
        { open: LeagueMode.OPEN, playedAt: match.playedAt },
      );

    const leagues = await qb.getMany();

    for (const league of leagues) {
      const memberCount = await manager
        .getRepository(LeagueMember)
        .createQueryBuilder('m')
        .where('m."leagueId" = :leagueId', { leagueId: league.id })
        .andWhere('m."userId" IN (:...playerIds)', { playerIds })
        .getCount();

      if (memberCount === 4) {
        await this.recomputeLeague(manager, league.id);
      }
    }
  }

  /**
   * Full recompute of standings for a league.
   * Queries all confirmed matches within the league date range where
   * all 4 participants are league members, then aggregates stats.
   */
  async recomputeLeague(
    manager: EntityManager,
    leagueId: string,
  ): Promise<LeagueMember[]> {
    const league = await manager
      .getRepository(League)
      .findOne({ where: { id: leagueId } });
    if (!league) return [];

    const members = await manager
      .getRepository(LeagueMember)
      .find({ where: { leagueId } });
    if (members.length === 0) return [];

    const memberUserIds = members.map((m) => m.userId);
    const memberSet = new Set(memberUserIds);

    // Get all confirmed matches; for SCHEDULED filter by date range
    const matchQb = manager
      .getRepository(MatchResult)
      .createQueryBuilder('mr')
      .innerJoinAndSelect('mr.challenge', 'c')
      .where('mr.status = :status', { status: MatchResultStatus.CONFIRMED });

    if (league.mode !== LeagueMode.OPEN && league.startDate && league.endDate) {
      matchQb
        .andWhere('mr."playedAt" >= :start', { start: league.startDate })
        .andWhere('mr."playedAt" <= :end', { end: league.endDate });
    }

    const matches = await matchQb.getMany();

    // Read configurable settings (fallback to defaults)
    const settings: LeagueSettings = league.settings ?? DEFAULT_LEAGUE_SETTINGS;
    const { winPoints, drawPoints, lossPoints } = settings;
    const includeSources = settings.includeSources ?? { RESERVATION: true, MANUAL: true };

    // Filter: all 4 participants must be league members + source filter
    const leagueMatches = matches.filter((mr) => {
      const ch = mr.challenge;

      // All 4 players must be league members
      if (
        !memberSet.has(ch.teamA1Id) ||
        !ch.teamA2Id || !memberSet.has(ch.teamA2Id) ||
        !ch.teamB1Id || !memberSet.has(ch.teamB1Id) ||
        !ch.teamB2Id || !memberSet.has(ch.teamB2Id)
      ) {
        return false;
      }

      // Filter by match source (reservation-backed vs manual)
      const isReservationBacked = ch.reservationId != null;
      if (isReservationBacked && !includeSources.RESERVATION) return false;
      if (!isReservationBacked && !includeSources.MANUAL) return false;

      return true;
    });

    // Aggregate stats per member
    const stats = new Map<
      string,
      { wins: number; losses: number; draws: number; setsDiff: number; gamesDiff: number }
    >();
    for (const uid of memberUserIds) {
      stats.set(uid, { wins: 0, losses: 0, draws: 0, setsDiff: 0, gamesDiff: 0 });
    }

    for (const mr of leagueMatches) {
      const ch = mr.challenge;
      const teamA = [ch.teamA1Id, ch.teamA2Id!];
      const teamB = [ch.teamB1Id!, ch.teamB2Id!];
      const winners = mr.winnerTeam === 'A' ? teamA : teamB;
      const losers = mr.winnerTeam === 'A' ? teamB : teamA;

      for (const uid of winners) {
        const s = stats.get(uid);
        if (s) s.wins++;
      }
      for (const uid of losers) {
        const s = stats.get(uid);
        if (s) s.losses++;
      }

      // Compute set and game differentials
      const sets = [
        { a: mr.teamASet1, b: mr.teamBSet1 },
        { a: mr.teamASet2, b: mr.teamBSet2 },
      ];
      if (mr.teamASet3 != null && mr.teamBSet3 != null) {
        sets.push({ a: mr.teamASet3, b: mr.teamBSet3 });
      }

      let setsWonA = 0;
      let setsWonB = 0;
      let gamesA = 0;
      let gamesB = 0;
      for (const set of sets) {
        gamesA += set.a;
        gamesB += set.b;
        if (set.a > set.b) setsWonA++;
        else if (set.b > set.a) setsWonB++;
      }

      for (const uid of teamA) {
        const s = stats.get(uid);
        if (s) {
          s.setsDiff += setsWonA - setsWonB;
          s.gamesDiff += gamesA - gamesB;
        }
      }
      for (const uid of teamB) {
        const s = stats.get(uid);
        if (s) {
          s.setsDiff += setsWonB - setsWonA;
          s.gamesDiff += gamesB - gamesA;
        }
      }
    }

    // Compute points and sort using configurable tie-breakers
    const ranked = members.map((m) => {
      const s = stats.get(m.userId) ?? { wins: 0, losses: 0, draws: 0, setsDiff: 0, gamesDiff: 0 };
      return {
        member: m,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        setsDiff: s.setsDiff,
        gamesDiff: s.gamesDiff,
        points: s.wins * winPoints + s.draws * drawPoints + s.losses * lossPoints,
      };
    });

    const tieBreakers = settings.tieBreakers;
    ranked.sort((a, b) => {
      for (const tb of tieBreakers) {
        const diff = (b[tb] ?? 0) - (a[tb] ?? 0);
        if (diff !== 0) return diff;
      }
      // Deterministic fallback: userId ASC (stable ordering)
      return a.member.userId.localeCompare(b.member.userId);
    });

    // Update members with computed values
    const memberRepo = manager.getRepository(LeagueMember);
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      r.member.points = r.points;
      r.member.wins = r.wins;
      r.member.losses = r.losses;
      r.member.draws = r.draws;
      r.member.setsDiff = r.setsDiff;
      r.member.gamesDiff = r.gamesDiff;
      r.member.position = i + 1;
    }

    await memberRepo.save(ranked.map((r) => r.member));

    this.logger.log(
      `standings recomputed: leagueId=${leagueId} members=${ranked.length} matches=${leagueMatches.length}`,
    );

    return ranked.map((r) => r.member);
  }
}
