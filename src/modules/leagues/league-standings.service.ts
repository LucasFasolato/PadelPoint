import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import { LeagueStatus } from './league-status.enum';
import { LeagueMode } from './league-mode.enum';
import {
  MatchResult,
  MatchResultStatus,
} from '../matches/match-result.entity';
import { Challenge } from '../challenges/challenge.entity';
import { CompetitiveProfile } from '../competitive/competitive-profile.entity';

const POINTS_WIN = 3;
const POINTS_DRAW = 1;
const DEFAULT_ELO = 1200;

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
    @InjectRepository(CompetitiveProfile)
    private readonly profileRepo: Repository<CompetitiveProfile>,
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

    // Filter: all 4 participants must be league members
    const leagueMatches = matches.filter((mr) => {
      const ch = mr.challenge;
      return (
        memberSet.has(ch.teamA1Id) &&
        ch.teamA2Id &&
        memberSet.has(ch.teamA2Id) &&
        ch.teamB1Id &&
        memberSet.has(ch.teamB1Id) &&
        ch.teamB2Id &&
        memberSet.has(ch.teamB2Id)
      );
    });

    // Aggregate stats per member
    const stats = new Map<
      string,
      { wins: number; losses: number; draws: number }
    >();
    for (const uid of memberUserIds) {
      stats.set(uid, { wins: 0, losses: 0, draws: 0 });
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
    }

    // Load ELO for tie-breaking
    const eloMap = new Map<string, number>();
    if (memberUserIds.length > 0) {
      const profiles = await manager
        .getRepository(CompetitiveProfile)
        .find({ where: { userId: In(memberUserIds) } });
      for (const p of profiles) {
        eloMap.set(p.userId, p.elo);
      }
    }

    // Compute points and sort
    const ranked = members.map((m) => {
      const s = stats.get(m.userId) ?? { wins: 0, losses: 0, draws: 0 };
      return {
        member: m,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        points: s.wins * POINTS_WIN + s.draws * POINTS_DRAW,
        elo: eloMap.get(m.userId) ?? DEFAULT_ELO,
      };
    });

    ranked.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.elo - a.elo;
    });

    // Update members with computed values
    const memberRepo = manager.getRepository(LeagueMember);
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      r.member.points = r.points;
      r.member.wins = r.wins;
      r.member.losses = r.losses;
      r.member.draws = r.draws;
      r.member.position = i + 1;
    }

    await memberRepo.save(ranked.map((r) => r.member));

    this.logger.log(
      `standings recomputed: leagueId=${leagueId} members=${ranked.length} matches=${leagueMatches.length}`,
    );

    return ranked.map((r) => r.member);
  }
}
