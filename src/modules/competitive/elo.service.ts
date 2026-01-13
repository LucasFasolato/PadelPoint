import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { EloHistory, EloHistoryReason } from './elo-history.entity';
import { CompetitiveProfile } from './competitive-profile.entity';
import {
  MatchResult,
  MatchResultStatus,
  WinnerTeam,
} from '../matches/match-result.entity';
import { Challenge } from '../challenges/challenge.entity';

@Injectable()
export class EloService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(EloHistory)
    private readonly historyRepo: Repository<EloHistory>,
    @InjectRepository(CompetitiveProfile)
    private readonly profileRepo: Repository<CompetitiveProfile>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
  ) {}

  private expectedScore(rA: number, rB: number) {
    return 1 / (1 + Math.pow(10, (rB - rA) / 400));
  }

  private kFactor(matchesPlayed: number) {
    if (matchesPlayed < 10) return 40;
    if (matchesPlayed < 30) return 32;
    return 24;
  }

  // Adjust this mapping if your Challenge fields differ.
  private extractParticipants(ch: any) {
    const a1 =
      ch.teamAPlayer1Id ??
      ch.teamAPlayer1?.id ??
      ch.playerA1Id ??
      ch.playerA1?.id;
    const a2 =
      ch.teamAPlayer2Id ??
      ch.teamAPlayer2?.id ??
      ch.playerA2Id ??
      ch.playerA2?.id;
    const b1 =
      ch.teamBPlayer1Id ??
      ch.teamBPlayer1?.id ??
      ch.playerB1Id ??
      ch.playerB1?.id;
    const b2 =
      ch.teamBPlayer2Id ??
      ch.teamBPlayer2?.id ??
      ch.playerB2Id ??
      ch.playerB2?.id;

    const ids = [a1, a2, b1, b2].filter(Boolean) as string[];
    if (ids.length !== 4)
      throw new BadRequestException('Challenge must have 4 players');

    return { teamA: [a1, a2], teamB: [b1, b2] };
  }

  private async getOrCreateProfile(manager: EntityManager, userId: string) {
    const repo = manager.getRepository(CompetitiveProfile);

    let p = await repo.findOne({ where: { userId }, relations: ['user'] });
    if (p) return p;

    // If your UsersService already exists you can use it, but inside tx we keep it simple:
    // We only need userId + relation, so we can set without loading user.
    p = repo.create({
      userId,
      elo: 1200,
      initialCategory: null,
      categoryLocked: false,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    } as CompetitiveProfile);

    return repo.save(p);
  }

  /**
   * Public wrapper (transaction-safe)
   */
  async applyForMatch(matchId: string) {
    return this.dataSource.transaction((manager) =>
      this.applyForMatchTx(manager, matchId),
    );
  }

  /**
   * Apply Elo inside an existing transaction.
   */
  async applyForMatchTx(manager: EntityManager, matchId: string) {
    const matchRepo = manager.getRepository(MatchResult);
    const challengeRepo = manager.getRepository(Challenge);
    const profileRepo = manager.getRepository(CompetitiveProfile);
    const historyRepo = manager.getRepository(EloHistory);

    const match = await matchRepo.findOne({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match result not found');

    if (match.status !== MatchResultStatus.CONFIRMED) {
      throw new BadRequestException('Match must be CONFIRMED to apply ELO');
    }

    // Idempotent #1
    if (match.eloApplied) return { ok: true, alreadyApplied: true };

    // Idempotent #2 (history exists for this match)
    const exists = await historyRepo.findOne({
      where: { reason: EloHistoryReason.MATCH_RESULT, refId: matchId },
    });
    if (exists) {
      match.eloApplied = true;
      await matchRepo.save(match);
      return { ok: true, alreadyApplied: true };
    }

    const challenge = await challengeRepo.findOne({
      where: { id: match.challengeId as any },
    });
    if (!challenge) throw new NotFoundException('Challenge not found');

    const { teamA, teamB } = this.extractParticipants(challenge);

    const pA1 = await this.getOrCreateProfile(manager, teamA[0]);
    const pA2 = await this.getOrCreateProfile(manager, teamA[1]);
    const pB1 = await this.getOrCreateProfile(manager, teamB[0]);
    const pB2 = await this.getOrCreateProfile(manager, teamB[1]);

    const teamARating = (pA1.elo + pA2.elo) / 2;
    const teamBRating = (pB1.elo + pB2.elo) / 2;

    const EA = this.expectedScore(teamARating, teamBRating);
    const EB = 1 - EA;

    const teamAWon = match.winnerTeam === WinnerTeam.A;
    const SA = teamAWon ? 1 : 0;
    const SB = teamAWon ? 0 : 1;

    const kA = Math.max(
      this.kFactor(pA1.matchesPlayed),
      this.kFactor(pA2.matchesPlayed),
    );
    const kB = Math.max(
      this.kFactor(pB1.matchesPlayed),
      this.kFactor(pB2.matchesPlayed),
    );

    const deltaA = Math.round(kA * (SA - EA));
    const deltaB = Math.round(kB * (SB - EB));

    const apply = (p: CompetitiveProfile, delta: number, won: boolean) => {
      const before = p.elo;
      const after = before + delta;

      p.elo = after;
      p.matchesPlayed += 1;
      p.categoryLocked = true; // lock on first match
      if (won) p.wins += 1;
      else p.losses += 1;

      return { before, after };
    };

    const a1 = apply(pA1, deltaA, teamAWon);
    const a2 = apply(pA2, deltaA, teamAWon);
    const b1 = apply(pB1, deltaB, !teamAWon);
    const b2 = apply(pB2, deltaB, !teamAWon);

    await profileRepo.save([pA1, pA2, pB1, pB2]);

    const profilesByUser: Record<string, CompetitiveProfile> = {
      [teamA[0]]: pA1,
      [teamA[1]]: pA2,
      [teamB[0]]: pB1,
      [teamB[1]]: pB2,
    };

    await historyRepo.save([
      historyRepo.create({
        profileId: profilesByUser[teamA[0]].id,
        eloBefore: a1.before,
        eloAfter: a1.after,
        delta: deltaA,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
      historyRepo.create({
        profileId: profilesByUser[teamA[1]].id,
        eloBefore: a2.before,
        eloAfter: a2.after,
        delta: deltaA,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
      historyRepo.create({
        profileId: profilesByUser[teamB[0]].id,
        eloBefore: b1.before,
        eloAfter: b1.after,
        delta: deltaB,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
      historyRepo.create({
        profileId: profilesByUser[teamB[1]].id,
        eloBefore: b2.before,
        eloAfter: b2.after,
        delta: deltaB,
        reason: EloHistoryReason.MATCH_RESULT,
        refId: matchId,
      }),
    ]);

    match.eloApplied = true;
    await matchRepo.save(match);

    return {
      ok: true,
      matchId,
      teamAWon,
      deltas: { teamA: deltaA, teamB: deltaB },
    };
  }
}
