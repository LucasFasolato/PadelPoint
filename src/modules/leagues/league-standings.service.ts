import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { League } from './league.entity';
import { LeagueMember } from './league-member.entity';
import {
  LeagueStandingsSnapshot,
  LeagueStandingsSnapshotRow,
} from './league-standings-snapshot.entity';
import { LeagueStatus } from './league-status.enum';
import { LeagueMode } from './league-mode.enum';
import { MatchResult, MatchResultStatus } from '../matches/match-result.entity';
import {
  DEFAULT_LEAGUE_SETTINGS,
  LeagueSettings,
} from './league-settings.type';
import {
  computeStandingsDiff,
  StandingsMovement,
} from './standings/standings-diff';
import { LeagueActivityService } from './league-activity.service';
import { LeagueActivityType } from './league-activity-type.enum';
import { UserNotificationsService } from '../../notifications/user-notifications.service';
import { UserNotificationType } from '../../notifications/user-notification-type.enum';

/** Max user notifications emitted per league per snapshot. */
const MAX_NOTIFICATIONS_PER_SNAPSHOT = 10;

@Injectable()
export class LeagueStandingsService {
  private readonly logger = new Logger(LeagueStandingsService.name);
  private readonly snapshotsToKeep = 30;
  private readonly snapshotInsertRetries = 3;

  constructor(
    @InjectRepository(League)
    private readonly leagueRepo: Repository<League>,
    @InjectRepository(LeagueMember)
    private readonly memberRepo: Repository<LeagueMember>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(LeagueStandingsSnapshot)
    private readonly snapshotRepo: Repository<LeagueStandingsSnapshot>,
    private readonly activityService: LeagueActivityService,
    private readonly userNotificationsService: UserNotificationsService,
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
    // For OPEN/MINI: no date restriction
    const qb = manager
      .getRepository(League)
      .createQueryBuilder('l')
      .where('l.status = :status', { status: LeagueStatus.ACTIVE })
      .andWhere(
        '(l.mode IN (:...alwaysActiveModes) OR (l."startDate" <= :playedAt AND l."endDate" >= :playedAt))',
        {
          alwaysActiveModes: [LeagueMode.OPEN, LeagueMode.MINI],
          playedAt: match.playedAt,
        },
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

    if (league.mode === LeagueMode.SCHEDULED && league.startDate && league.endDate) {
      matchQb
        .andWhere('mr."playedAt" >= :start', { start: league.startDate })
        .andWhere('mr."playedAt" <= :end', { end: league.endDate });
    }

    const matches = await matchQb.getMany();

    // Read configurable settings (fallback to defaults)
    const settings: LeagueSettings = league.settings ?? DEFAULT_LEAGUE_SETTINGS;
    const { winPoints, drawPoints, lossPoints } = settings;
    const includeSources = settings.includeSources ?? {
      RESERVATION: true,
      MANUAL: true,
    };

    // Filter: all 4 participants must be league members + source filter
    const leagueMatches = matches.filter((mr) => {
      const ch = mr.challenge;

      // All 4 players must be league members
      if (
        !memberSet.has(ch.teamA1Id) ||
        !ch.teamA2Id ||
        !memberSet.has(ch.teamA2Id) ||
        !ch.teamB1Id ||
        !memberSet.has(ch.teamB1Id) ||
        !ch.teamB2Id ||
        !memberSet.has(ch.teamB2Id)
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
      {
        wins: number;
        losses: number;
        draws: number;
        setsDiff: number;
        gamesDiff: number;
        lastWinAt: Date | null;
      }
    >();
    for (const uid of memberUserIds) {
      stats.set(uid, {
        wins: 0,
        losses: 0,
        draws: 0,
        setsDiff: 0,
        gamesDiff: 0,
        lastWinAt: null,
      });
    }

    for (const mr of leagueMatches) {
      const ch = mr.challenge;
      const teamA = [ch.teamA1Id, ch.teamA2Id];
      const teamB = [ch.teamB1Id, ch.teamB2Id];
      const winners = mr.winnerTeam === 'A' ? teamA : teamB;
      const losers = mr.winnerTeam === 'A' ? teamB : teamA;

      for (const uid of winners) {
        const s = stats.get(uid);
        if (s) {
          s.wins++;
          // Track most recent win timestamp for tie-breaking
          if (!s.lastWinAt || mr.playedAt > s.lastWinAt) {
            s.lastWinAt = mr.playedAt;
          }
        }
      }
      for (const uid of losers) {
        const s = stats.get(uid);
        if (s) s.losses++;
      }

      // Compute set and game differentials (defensive ?? 0 for DB null safety)
      const sets = [
        { a: mr.teamASet1 ?? 0, b: mr.teamBSet1 ?? 0 },
        { a: mr.teamASet2 ?? 0, b: mr.teamBSet2 ?? 0 },
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
      const s = stats.get(m.userId) ?? {
        wins: 0,
        losses: 0,
        draws: 0,
        setsDiff: 0,
        gamesDiff: 0,
        lastWinAt: null,
      };
      return {
        member: m,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        setsDiff: s.setsDiff,
        gamesDiff: s.gamesDiff,
        lastWinAt: s.lastWinAt,
        points:
          s.wins * winPoints + s.draws * drawPoints + s.losses * lossPoints,
      };
    });

    // Explicit deterministic sort chain:
    // (1-4) configurable tiebreakers (default: points → wins → setsDiff → gamesDiff)
    // (5) lastWinAt DESC — more recent win ranks higher
    // (6) userId ASC — stable final tiebreaker
    const tieBreakers = settings.tieBreakers;
    ranked.sort((a, b) => {
      for (const tb of tieBreakers) {
        const diff = (b[tb] ?? 0) - (a[tb] ?? 0);
        if (diff !== 0) return diff;
      }
      // lastWinAt DESC: player who won more recently ranks higher when stats are equal
      const aLWA = a.lastWinAt?.getTime() ?? 0;
      const bLWA = b.lastWinAt?.getTime() ?? 0;
      if (bLWA !== aLWA) return bLWA - aLWA;
      // userId ASC: final stable deterministic tiebreaker
      return a.member.userId.localeCompare(b.member.userId);
    });

    const snapshotRows: LeagueStandingsSnapshotRow[] = [];

    // Update members with computed values
    const memberRepo = manager.getRepository(LeagueMember);
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const position = i + 1;
      r.member.points = r.points;
      r.member.wins = r.wins;
      r.member.losses = r.losses;
      r.member.draws = r.draws;
      r.member.setsDiff = r.setsDiff;
      r.member.gamesDiff = r.gamesDiff;
      r.member.position = position;

      snapshotRows.push({
        userId: r.member.userId,
        points: r.points,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        setsDiff: r.setsDiff,
        gamesDiff: r.gamesDiff,
        position,
        ...(r.lastWinAt ? { lastWinAt: r.lastWinAt.toISOString() } : {}),
      });
    }

    await memberRepo.save(ranked.map((r) => r.member));

    const snapshot = await this.persistSnapshot(
      manager,
      leagueId,
      snapshotRows,
      leagueMatches.length,
    );

    this.logger.log(
      `standings recomputed: leagueId=${leagueId} members=${ranked.length} matches=${leagueMatches.length} snapshotVersion=${snapshot.version} checksum=${snapshot.checksum}`,
    );

    // Emit activity + per-player notifications (best-effort; failures are logged, not thrown)
    try {
      await this.emitSnapshotEvents(
        leagueId,
        league.name,
        snapshot.computedAt,
        snapshot.movements,
      );
    } catch (err) {
      this.logger.error(
        `emitSnapshotEvents failed: leagueId=${leagueId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return ranked.map((r) => r.member);
  }

  async getStandingsWithMovement(leagueId: string): Promise<{
    computedAt: string | null;
    rows: LeagueStandingsSnapshotRow[];
    movement: Record<string, { delta: number }>;
  }> {
    const latest = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s."leagueId" = :leagueId', { leagueId })
      .orderBy('s.version', 'DESC')
      .addOrderBy('s."computedAt"', 'DESC')
      .getOne();

    let rows: LeagueStandingsSnapshotRow[];
    let movement: Record<string, { delta: number }>;

    if (!latest) {
      rows = await this.getCurrentRowsFromMembers(leagueId);
      movement = this.computeMovement(rows, null);
      return { computedAt: null, rows, movement };
    }

    const previous = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s."leagueId" = :leagueId', { leagueId })
      .andWhere('s.version < :version', { version: latest.version })
      .orderBy('s.version', 'DESC')
      .addOrderBy('s."computedAt"', 'DESC')
      .getOne();

    rows = latest.rows ?? [];
    movement = this.computeMovement(rows, previous?.rows ?? null);

    return {
      computedAt: latest.computedAt.toISOString(),
      rows,
      movement,
    };
  }

  async getStandingsHistory(
    leagueId: string,
    limit = 10,
  ): Promise<Array<{ version: number; computedAt: string }>> {
    const safeLimit = Math.min(50, Math.max(1, limit || 10));
    const snapshots = await this.snapshotRepo.find({
      where: { leagueId },
      select: ['version', 'computedAt'],
      order: { version: 'DESC' },
      take: safeLimit,
    });

    return snapshots.map((s) => ({
      version: s.version,
      computedAt: s.computedAt.toISOString(),
    }));
  }

  async getStandingsSnapshotByVersion(
    leagueId: string,
    version: number,
  ): Promise<{
    version: number;
    computedAt: string;
    rows: LeagueStandingsSnapshotRow[];
  } | null> {
    const snapshot = await this.snapshotRepo.findOne({
      where: { leagueId, version },
    });
    if (!snapshot) return null;

    return {
      version: snapshot.version,
      computedAt: snapshot.computedAt.toISOString(),
      rows: snapshot.rows ?? [],
    };
  }

  /**
   * Returns the latest standings snapshot enriched with full movement detail
   * and a top-movers summary.  Safe to call even before the first snapshot
   * exists (falls back to live member data with all-NEW movements).
   */
  async getLatestStandings(leagueId: string): Promise<{
    computedAt: string | null;
    table: LeagueStandingsSnapshotRow[];
    movements: StandingsMovement[];
    topMovers: { up: StandingsMovement[]; down: StandingsMovement[] };
  }> {
    const latest = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s."leagueId" = :leagueId', { leagueId })
      .orderBy('s.version', 'DESC')
      .getOne();

    if (!latest) {
      const table = await this.getCurrentRowsFromMembers(leagueId);
      const movements = computeStandingsDiff([], table);
      return { computedAt: null, table, movements, topMovers: { up: [], down: [] } };
    }

    const prevSnapshot = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s."leagueId" = :leagueId', { leagueId })
      .andWhere('s.version < :version', { version: latest.version })
      .orderBy('s.version', 'DESC')
      .getOne();

    const table = latest.rows ?? [];
    // Re-compute movements from persisted row positions for full accuracy
    // (handles snapshots written before movement embedding was introduced)
    const movements = computeStandingsDiff(prevSnapshot?.rows ?? [], table);

    const topMovers = {
      up: movements.filter((m) => m.movementType === 'UP').slice(0, 3),
      down: movements.filter((m) => m.movementType === 'DOWN').slice(0, 3),
    };

    return {
      computedAt: latest.computedAt.toISOString(),
      table,
      movements,
      topMovers,
    };
  }

  private async persistSnapshot(
    manager: EntityManager,
    leagueId: string,
    rows: LeagueStandingsSnapshotRow[],
    totalMatchesUsed: number,
  ): Promise<LeagueStandingsSnapshot & { checksum: string; movements: StandingsMovement[] }> {
    // Stable JSON ordering: rows sorted by position ASC then userId ASC before persistence
    const stableRows = [...rows].sort(
      (a, b) => a.position - b.position || a.userId.localeCompare(b.userId),
    );

    const repo = manager.getRepository(LeagueStandingsSnapshot);

    // Fetch the most recent snapshot BEFORE writing the new one so we can
    // compute ranking movements and embed them into each persisted row.
    const prevSnapshot = await repo
      .createQueryBuilder('s')
      .where('s."leagueId" = :leagueId', { leagueId })
      .orderBy('s.version', 'DESC')
      .getOne();

    const movements = computeStandingsDiff(
      prevSnapshot?.rows ?? [],
      stableRows,
    );
    const movementByUser = new Map(movements.map((m) => [m.userId, m]));

    // Enrich each row with movement metadata for direct consumers
    const enrichedRows: LeagueStandingsSnapshotRow[] = stableRows.map(
      (row) => {
        const mv = movementByUser.get(row.userId);
        if (!mv) return row;
        return {
          ...row,
          delta: mv.delta,
          oldPosition: mv.oldPosition,
          movementType: mv.movementType,
        };
      },
    );

    // Deterministic checksum over the pure stats payload (movement is derived)
    const checksum = createHash('sha256')
      .update(JSON.stringify(stableRows))
      .digest('hex')
      .slice(0, 16);

    this.logger.debug(
      `snapshot integrity: leagueId=${leagueId} totalMatchesUsed=${totalMatchesUsed} checksum=${checksum}`,
    );

    for (let attempt = 0; attempt < this.snapshotInsertRetries; attempt++) {
      const raw = await repo
        .createQueryBuilder('s')
        .select('COALESCE(MAX(s.version), 0) + 1', 'nextVersion')
        .where('s."leagueId" = :leagueId', { leagueId })
        .getRawOne<{ nextVersion: string }>();

      const nextVersion = Number(raw?.nextVersion ?? 1);

      try {
        const saved = await repo.save(
          repo.create({
            leagueId,
            version: nextVersion,
            rows: enrichedRows,
          }),
        );

        await this.pruneSnapshots(manager, leagueId, this.snapshotsToKeep);
        return { ...saved, checksum, movements };
      } catch (err) {
        if (this.isLeagueVersionUniqueConflict(err)) {
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Unable to persist standings snapshot for league ${leagueId}`,
    );
  }

  private async pruneSnapshots(
    manager: EntityManager,
    leagueId: string,
    keep: number,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM "league_standings_snapshots"
       WHERE "leagueId" = $1
         AND id IN (
           SELECT id
           FROM "league_standings_snapshots"
           WHERE "leagueId" = $1
           ORDER BY version DESC
           OFFSET $2
         )`,
      [leagueId, keep],
    );
  }

  private async getCurrentRowsFromMembers(
    leagueId: string,
  ): Promise<LeagueStandingsSnapshotRow[]> {
    const members = await this.memberRepo
      .createQueryBuilder('m')
      .where('m."leagueId" = :leagueId', { leagueId })
      .orderBy('m.position', 'ASC', 'NULLS LAST')
      .addOrderBy('m."userId"', 'ASC')
      .getMany();

    return members.map((m, index) => ({
      userId: m.userId,
      points: m.points ?? 0,
      wins: m.wins ?? 0,
      losses: m.losses ?? 0,
      draws: m.draws ?? 0,
      setsDiff: m.setsDiff ?? 0,
      gamesDiff: m.gamesDiff ?? 0,
      position: m.position ?? index + 1,
    }));
  }

  private computeMovement(
    currentRows: LeagueStandingsSnapshotRow[],
    previousRows: LeagueStandingsSnapshotRow[] | null,
  ): Record<string, { delta: number }> {
    const movement: Record<string, { delta: number }> = {};
    if (!previousRows) {
      for (const row of currentRows) {
        movement[row.userId] = { delta: 0 };
      }
      return movement;
    }

    const previousPositions = new Map<string, number>();
    for (const row of previousRows) {
      previousPositions.set(row.userId, row.position);
    }

    for (const row of currentRows) {
      const previousPosition =
        previousPositions.get(row.userId) ?? row.position;
      movement[row.userId] = { delta: row.position - previousPosition };
    }

    return movement;
  }

  /**
   * Emit one league activity entry and one user notification per eligible
   * mover after a new standings snapshot is created.
   *
   * Runs outside the snapshot transaction — failures are logged but never
   * propagate back to the caller.
   */
  private async emitSnapshotEvents(
    leagueId: string,
    leagueName: string,
    computedAt: Date,
    movements: StandingsMovement[],
  ): Promise<void> {
    const computedAtISO = computedAt.toISOString();

    // ── League activity: one compact entry per snapshot ──────────────────────
    const topMovers = {
      up: movements
        .filter((m) => m.movementType === 'UP')
        .slice(0, 3)
        .map(({ userId, delta, newPosition }) => ({ userId, delta, newPosition })),
      down: movements
        .filter((m) => m.movementType === 'DOWN')
        .slice(0, 3)
        .map(({ userId, delta, newPosition }) => ({ userId, delta, newPosition })),
    };

    try {
      await this.activityService.create({
        leagueId,
        type: LeagueActivityType.RANKINGS_UPDATED,
        actorId: null,
        entityId: null,
        payload: { computedAt: computedAtISO, topMovers },
      });
    } catch (err) {
      this.logger.error(
        `league activity emit failed: leagueId=${leagueId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── User notifications ────────────────────────────────────────────────────
    // Eligible: UP or DOWN with |delta| >= 1, or NEW.
    // movements is already sorted by |delta| DESC then userId ASC.
    const eligible = movements.filter(
      (m) =>
        m.movementType === 'NEW' ||
        ((m.movementType === 'UP' || m.movementType === 'DOWN') &&
          m.delta !== null &&
          Math.abs(m.delta) >= 1),
    );

    if (eligible.length === 0) return;

    // Idempotency: skip entire batch if already sent for this snapshot
    try {
      const alreadySent =
        await this.userNotificationsService.hasRankingMovedForSnapshot(
          leagueId,
          computedAtISO,
        );
      if (alreadySent) {
        this.logger.debug(
          `ranking notifications already sent: leagueId=${leagueId} computedAt=${computedAtISO}`,
        );
        return;
      }
    } catch (err) {
      this.logger.warn(
        `idempotency check failed, proceeding: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Cap at MAX_NOTIFICATIONS_PER_SNAPSHOT (deterministic: biggest movers first)
    const capped = eligible.slice(0, MAX_NOTIFICATIONS_PER_SNAPSHOT);

    for (const mv of capped) {
      try {
        await this.userNotificationsService.create({
          userId: mv.userId,
          type: UserNotificationType.LEAGUE_RANKING_MOVED,
          title: this.buildRankingTitle(mv),
          body: null,
          data: {
            leagueId,
            leagueName,
            userId: mv.userId,
            oldPosition: mv.oldPosition,
            newPosition: mv.newPosition,
            delta: mv.delta,
            movementType: mv.movementType,
            reason: 'standings_snapshot',
            computedAt: computedAtISO,
          },
        });
      } catch (err) {
        this.logger.error(
          `ranking notification failed: userId=${mv.userId} leagueId=${leagueId} error=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private buildRankingTitle(mv: StandingsMovement): string {
    if (mv.movementType === 'NEW') {
      return `You entered the rankings at position #${mv.newPosition}`;
    }
    if (mv.movementType === 'UP') {
      const places = mv.delta === 1 ? '1 place' : `${mv.delta} places`;
      return `You moved up ${places} to #${mv.newPosition}`;
    }
    if (mv.movementType === 'DOWN') {
      const n = Math.abs(mv.delta!);
      const places = n === 1 ? '1 place' : `${n} places`;
      return `You moved down ${places} to #${mv.newPosition}`;
    }
    return `Your ranking is now #${mv.newPosition}`;
  }

  private isLeagueVersionUniqueConflict(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const code = (err as QueryFailedError & { code?: string }).code;
    return code === '23505';
  }
}
