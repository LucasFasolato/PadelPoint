import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Club } from '@/modules/legacy/clubs/club.entity';
import { Court } from '@/modules/legacy/courts/court.entity';
import { MatchCoordinationStatus } from '@/modules/core/matches-v2/enums/match-coordination-status.enum';
import { MatchMessageResponseDto } from '@/modules/core/matches-v2/dto/match-message-response.dto';
import { MatchProposalResponseDto } from '@/modules/core/matches-v2/dto/match-proposal-response.dto';
import { MatchResponseDto } from '@/modules/core/matches-v2/dto/match-response.dto';
import { MatchQueryService } from '@/modules/core/matches-v2/services/match-query.service';
import { MatchSchedulingService } from '@/modules/core/matches-v2/services/match-scheduling.service';
import { User } from '../../users/entities/user.entity';
import { CreateChallengeMessageDto } from '../dto/create-challenge-message.dto';
import { CreateChallengeProposalDto } from '../dto/create-challenge-proposal.dto';
import {
  ChallengeCoordinationResponseDto,
  ChallengeCoordinationUserDto,
  ChallengeMessageResponseDto,
  ChallengeProposalResponseDto,
  ChallengeScheduleResponseDto,
} from '../dto/challenge-coordination-response.dto';
import { Challenge } from '../entities/challenge.entity';
import { ChallengeCoordinationStatus } from '../enums/challenge-coordination-status.enum';
import { ChallengeScheduleProposalStatus } from '../enums/challenge-schedule-proposal-status.enum';
import { ChallengeStatus } from '../enums/challenge-status.enum';
import { ChallengeCoordinationService } from './challenge-coordination.service';

type KnownUser = Pick<User, 'id' | 'displayName' | 'email'>;

// Flow ownership map for challenge coordination compatibility:
// - `getCoordinationState`, `listMessages`, `createProposal`, `createMessage`:
//   fallback flows. Delegate when the legacy challenge already correlates to a
//   canonical match; otherwise legacy keeps ownership.
// - `acceptProposal`, `rejectProposal`: fallback flows with an extra invariant:
//   the public proposal id must resolve canonically, otherwise legacy keeps the
//   old proposal-id contract and avoids reader/writer drift.
@Injectable()
export class ChallengesV2CoordinationBridgeService {
  constructor(
    private readonly matchQueryService: MatchQueryService,
    private readonly matchSchedulingService: MatchSchedulingService,
    private readonly legacyCoordinationService: ChallengeCoordinationService,
    @InjectRepository(Challenge)
    private readonly challengeRepository: Repository<Challenge>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Club)
    private readonly clubRepository: Repository<Club>,
    @InjectRepository(Court)
    private readonly courtRepository: Repository<Court>,
  ) {}

  async getCoordinationState(
    challengeId: string,
    actorUserId: string,
  ): Promise<ChallengeCoordinationResponseDto> {
    const context = await this.resolveCoordinationContext(
      challengeId,
      actorUserId,
    );

    if (this.shouldFallbackToLegacyCoordinationRead(context.match)) {
      // Keep pre-v2 challenges readable until the legacy scheduling writes
      // switch over to the canonical match aggregate in the next bridge lot.
      return this.legacyCoordinationService.getCoordinationState(
        challengeId,
        actorUserId,
      );
    }

    const match = context.match;
    const usersById = await this.loadUsersById(context.challenge, match);
    const clubsById = await this.loadClubNamesById(match);
    const courtsById = await this.loadCourtNamesById(match);
    const proposals = this.sortByCreatedDesc(match.proposals ?? []);
    const messages = this.sortByCreatedAsc(match.messages ?? []);
    const pendingProposal =
      proposals.find(
        (proposal) =>
          proposal.status === ChallengeScheduleProposalStatus.PENDING,
      ) ?? null;

    return {
      challengeId: context.challenge.id,
      challengeStatus: context.challenge.status,
      coordinationStatus: this.resolveCoordinationStatus(
        context.challenge,
        match,
      ),
      matchType: context.challenge.matchType,
      matchId: match.id,
      participants: this.getParticipants(context.challenge).map((participant) =>
        this.toRequiredUserDto(participant),
      ),
      opponent: this.resolveOpponent(context.challenge, actorUserId),
      acceptedSchedule: this.resolveAcceptedSchedule(
        context.challenge,
        match,
        clubsById,
        courtsById,
      ),
      pendingProposal: pendingProposal
        ? this.toProposalDto(pendingProposal, usersById, clubsById, courtsById)
        : null,
      proposals: proposals.map((proposal) =>
        this.toProposalDto(proposal, usersById, clubsById, courtsById),
      ),
      messages: messages.map((message) =>
        this.toMessageDto(message, usersById),
      ),
    };
  }

  async listMessages(
    challengeId: string,
    actorUserId: string,
  ): Promise<ChallengeMessageResponseDto[]> {
    const context = await this.resolveCoordinationContext(
      challengeId,
      actorUserId,
    );

    if (this.shouldFallbackToLegacyCoordinationRead(context.match)) {
      return this.legacyCoordinationService.listMessages(
        challengeId,
        actorUserId,
      );
    }

    const match = context.match;
    const usersById = await this.loadUsersById(context.challenge, match);
    return this.sortByCreatedAsc(match.messages ?? []).map((message) =>
      this.toMessageDto(message, usersById),
    );
  }

  async createProposal(
    challengeId: string,
    actorUserId: string,
    dto: CreateChallengeProposalDto,
  ): Promise<ChallengeCoordinationResponseDto> {
    const context = await this.resolveCoordinationContext(
      challengeId,
      actorUserId,
    );

    if (this.shouldFallbackToLegacyCoordinationWrite(context.match)) {
      return this.legacyCoordinationService.createProposal(
        challengeId,
        actorUserId,
        dto,
      );
    }

    const match = context.match;
    await this.matchSchedulingService.createProposal(match.id, actorUserId, {
      scheduledAt: dto.scheduledAt,
      locationLabel: dto.locationLabel,
      clubId: dto.clubId,
      courtId: dto.courtId,
      note: dto.note,
    });

    return this.getCoordinationState(challengeId, actorUserId);
  }

  async acceptProposal(
    challengeId: string,
    proposalId: string,
    actorUserId: string,
  ): Promise<ChallengeCoordinationResponseDto> {
    const context = await this.resolveCoordinationContext(
      challengeId,
      actorUserId,
    );

    if (
      this.shouldFallbackToLegacyProposalDecision(context.match, proposalId)
    ) {
      return this.legacyCoordinationService.acceptProposal(
        challengeId,
        proposalId,
        actorUserId,
      );
    }

    const match = context.match;
    await this.matchSchedulingService.acceptProposal(
      match.id,
      proposalId,
      actorUserId,
    );

    return this.getCoordinationState(challengeId, actorUserId);
  }

  async rejectProposal(
    challengeId: string,
    proposalId: string,
    actorUserId: string,
  ): Promise<ChallengeCoordinationResponseDto> {
    const context = await this.resolveCoordinationContext(
      challengeId,
      actorUserId,
    );

    if (
      this.shouldFallbackToLegacyProposalDecision(context.match, proposalId)
    ) {
      return this.legacyCoordinationService.rejectProposal(
        challengeId,
        proposalId,
        actorUserId,
      );
    }

    const match = context.match;
    await this.matchSchedulingService.rejectProposal(
      match.id,
      proposalId,
      actorUserId,
      {},
    );

    return this.getCoordinationState(challengeId, actorUserId);
  }

  async createMessage(
    challengeId: string,
    actorUserId: string,
    dto: CreateChallengeMessageDto,
  ): Promise<ChallengeMessageResponseDto> {
    const context = await this.resolveCoordinationContext(
      challengeId,
      actorUserId,
    );

    if (this.shouldFallbackToLegacyCoordinationWrite(context.match)) {
      return this.legacyCoordinationService.createMessage(
        challengeId,
        actorUserId,
        dto,
      );
    }

    const match = context.match;
    const createdMessage = await this.matchSchedulingService.postMessage(
      match.id,
      actorUserId,
      { message: dto.message },
    );
    const messages = await this.listMessages(challengeId, actorUserId);
    const hydratedMessage = messages.find(
      (message) => message.id === createdMessage.id,
    );

    if (hydratedMessage) {
      return hydratedMessage;
    }

    const usersById = await this.loadUsersByIds(context.challenge, [
      createdMessage.senderUserId,
    ]);
    return this.toMessageDto(createdMessage, usersById);
  }

  private async resolveCoordinationContext(
    challengeId: string,
    actorUserId: string,
  ): Promise<{ challenge: Challenge; match: MatchResponseDto | null }> {
    const challenge = await this.getChallengeOrThrow(challengeId);
    this.assertParticipantOrThrow(challenge, actorUserId);

    return {
      challenge,
      match: await this.resolveCanonicalMatchForChallenge(challengeId),
    };
  }

  private async getChallengeOrThrow(challengeId: string): Promise<Challenge> {
    const challenge = await this.challengeRepository.findOne({
      where: { id: challengeId },
      relations: [
        'teamA1',
        'teamA2',
        'teamB1',
        'teamB2',
        'invitedOpponent',
        'club',
        'court',
      ],
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    return challenge;
  }

  private assertParticipantOrThrow(challenge: Challenge, userId: string): void {
    const participantIds = new Set(
      [
        challenge.teamA1Id,
        challenge.teamA2Id,
        challenge.teamB1Id,
        challenge.teamB2Id,
        challenge.invitedOpponentId,
      ].filter((id): id is string => Boolean(id)),
    );

    if (!participantIds.has(userId)) {
      throw new ForbiddenException(
        'Only challenge participants can access coordination',
      );
    }
  }

  private async loadUsersById(
    challenge: Challenge,
    match: MatchResponseDto,
  ): Promise<Map<string, KnownUser>> {
    return this.loadUsersByIds(challenge, [
      match.teamAPlayer1Id,
      match.teamAPlayer2Id,
      match.teamBPlayer1Id,
      match.teamBPlayer2Id,
      ...(match.proposals ?? []).map((proposal) => proposal.proposedByUserId),
      ...(match.messages ?? []).map((message) => message.senderUserId),
    ]);
  }

  private async loadClubNamesById(
    match: MatchResponseDto,
  ): Promise<Map<string, string>> {
    const clubIds = [
      ...new Set(
        [
          match.clubId,
          match.latestAcceptedProposal?.clubId ?? null,
          ...(match.proposals ?? []).map((proposal) => proposal.clubId),
        ].filter((clubId): clubId is string => Boolean(clubId)),
      ),
    ];

    if (clubIds.length === 0) {
      return new Map();
    }

    const clubs = await this.clubRepository.find({
      where: { id: In(clubIds) },
    });

    return new Map(clubs.map((club) => [club.id, club.nombre]));
  }

  private async loadCourtNamesById(
    match: MatchResponseDto,
  ): Promise<Map<string, string>> {
    const courtIds = [
      ...new Set(
        [
          match.courtId,
          match.latestAcceptedProposal?.courtId ?? null,
          ...(match.proposals ?? []).map((proposal) => proposal.courtId),
        ].filter((courtId): courtId is string => Boolean(courtId)),
      ),
    ];

    if (courtIds.length === 0) {
      return new Map();
    }

    const courts = await this.courtRepository.find({
      where: { id: In(courtIds) },
    });

    return new Map(courts.map((court) => [court.id, court.nombre]));
  }

  private resolveCoordinationStatus(
    challenge: Pick<Challenge, 'status' | 'coordinationStatus' | 'scheduledAt'>,
    match: Pick<MatchResponseDto, 'coordinationStatus' | 'scheduledAt'>,
  ): ChallengeCoordinationStatus | null {
    if (match.coordinationStatus === MatchCoordinationStatus.SCHEDULED) {
      return ChallengeCoordinationStatus.SCHEDULED;
    }

    if (match.coordinationStatus === MatchCoordinationStatus.COORDINATING) {
      return ChallengeCoordinationStatus.COORDINATING;
    }

    if (match.scheduledAt) {
      return ChallengeCoordinationStatus.SCHEDULED;
    }

    if (challenge.coordinationStatus) {
      return challenge.coordinationStatus;
    }

    if (challenge.scheduledAt) {
      return ChallengeCoordinationStatus.SCHEDULED;
    }

    if (
      [ChallengeStatus.ACCEPTED, ChallengeStatus.READY].includes(
        challenge.status,
      )
    ) {
      return ChallengeCoordinationStatus.ACCEPTED;
    }

    return null;
  }

  private async resolveCanonicalMatchForChallenge(
    challengeId: string,
  ): Promise<MatchResponseDto | null> {
    const match =
      await this.matchQueryService.findByLegacyChallengeId(challengeId);

    return this.hasSafeLegacyChallengeCorrelation(match, challengeId)
      ? match
      : null;
  }

  private hasSafeLegacyChallengeCorrelation(
    match: MatchResponseDto | null,
    challengeId: string,
  ): match is MatchResponseDto {
    return Boolean(match) && match.legacyChallengeId === challengeId;
  }

  private shouldFallbackToLegacyCoordinationRead(
    match: MatchResponseDto | null,
  ): boolean {
    return !match;
  }

  private shouldFallbackToLegacyCoordinationWrite(
    match: MatchResponseDto | null,
  ): boolean {
    return !match;
  }

  private shouldFallbackToLegacyProposalDecision(
    match: MatchResponseDto | null,
    proposalId: string,
  ): boolean {
    if (!match) {
      return true;
    }

    // Keep legacy proposal ids working while pre-v2 clients and cached reads
    // are still in circulation. Canonical ids are exposed only after a safe
    // delegated read, so unresolved public ids must stay on legacy.
    return !this.isResolvableCanonicalProposalId(match, proposalId);
  }

  private resolveCanonicalProposalId(
    match: MatchResponseDto,
    proposalId: string,
  ): string | null {
    const proposal = (match.proposals ?? []).find(
      (candidate) => candidate.id === proposalId,
    );
    return proposal?.id ?? null;
  }

  private isResolvableCanonicalProposalId(
    match: MatchResponseDto,
    proposalId: string,
  ): boolean {
    return this.resolveCanonicalProposalId(match, proposalId) !== null;
  }

  private resolveAcceptedSchedule(
    challenge: Challenge,
    match: MatchResponseDto,
    clubsById: Map<string, string>,
    courtsById: Map<string, string>,
  ): ChallengeScheduleResponseDto | null {
    if (match.latestAcceptedProposal) {
      return this.toScheduleDto(
        match.latestAcceptedProposal,
        clubsById,
        courtsById,
      );
    }

    if (match.scheduledAt) {
      return {
        scheduledAt: match.scheduledAt,
        locationLabel: match.locationLabel,
        clubId: match.clubId,
        clubName: match.clubId ? (clubsById.get(match.clubId) ?? null) : null,
        courtId: match.courtId,
        courtName: match.courtId
          ? (courtsById.get(match.courtId) ?? null)
          : null,
        note: null,
      };
    }

    if (!challenge.scheduledAt) {
      return null;
    }

    return {
      scheduledAt: challenge.scheduledAt.toISOString(),
      locationLabel: challenge.locationLabel,
      clubId: challenge.clubId,
      clubName: challenge.club?.nombre ?? null,
      courtId: challenge.courtId,
      courtName: challenge.court?.nombre ?? null,
      note: null,
    };
  }

  private getParticipants(challenge: Challenge): User[] {
    const participants = [
      challenge.teamA1,
      challenge.teamA2,
      challenge.teamB1,
      challenge.teamB2,
      challenge.invitedOpponent,
    ].filter((user): user is User => Boolean(user));

    return [
      ...new Map(
        participants.map((participant) => [participant.id, participant]),
      ).values(),
    ];
  }

  private resolveOpponent(
    challenge: Challenge,
    userId: string,
  ): ChallengeCoordinationUserDto | null {
    const isTeamA =
      challenge.teamA1Id === userId || challenge.teamA2Id === userId;
    const isTeamB =
      challenge.teamB1Id === userId ||
      challenge.teamB2Id === userId ||
      challenge.invitedOpponentId === userId;

    if (isTeamA) {
      return this.toUserDto(
        challenge.teamB1 ?? challenge.invitedOpponent ?? null,
      );
    }

    if (isTeamB) {
      return this.toUserDto(challenge.teamA1 ?? null);
    }

    return null;
  }

  private toScheduleDto(
    proposal: MatchProposalResponseDto,
    clubsById: Map<string, string>,
    courtsById: Map<string, string>,
  ): ChallengeScheduleResponseDto {
    return {
      scheduledAt: proposal.scheduledAt,
      locationLabel: proposal.locationLabel,
      clubId: proposal.clubId,
      clubName: proposal.clubId
        ? (clubsById.get(proposal.clubId) ?? null)
        : null,
      courtId: proposal.courtId,
      courtName: proposal.courtId
        ? (courtsById.get(proposal.courtId) ?? null)
        : null,
      note: proposal.note,
    };
  }

  private toProposalDto(
    proposal: MatchProposalResponseDto,
    usersById: Map<string, KnownUser>,
    clubsById: Map<string, string>,
    courtsById: Map<string, string>,
  ): ChallengeProposalResponseDto {
    return {
      id: proposal.id,
      status: proposal.status,
      proposedBy: this.toKnownUserDto(usersById.get(proposal.proposedByUserId)),
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      ...this.toScheduleDto(proposal, clubsById, courtsById),
    };
  }

  private toMessageDto(
    message: MatchMessageResponseDto,
    usersById: Map<string, KnownUser>,
  ): ChallengeMessageResponseDto {
    return {
      id: message.id,
      message: message.message,
      sender: this.toKnownUserDto(usersById.get(message.senderUserId)),
      createdAt: message.createdAt,
    };
  }

  private toUserDto(user: User | null): ChallengeCoordinationUserDto | null {
    if (!user) {
      return null;
    }

    return {
      userId: user.id,
      displayName: this.resolveDisplayName(user),
    };
  }

  private toRequiredUserDto(user: User): ChallengeCoordinationUserDto {
    return {
      userId: user.id,
      displayName: this.resolveDisplayName(user),
    };
  }

  private toKnownUserDto(user?: KnownUser): ChallengeCoordinationUserDto {
    return {
      userId: user?.id ?? '',
      displayName: user ? this.resolveDisplayName(user) : null,
    };
  }

  private async loadUsersByIds(
    challenge: Challenge,
    userIds: Array<string | null | undefined>,
  ): Promise<Map<string, KnownUser>> {
    const usersById = new Map<string, KnownUser>(
      this.getParticipants(challenge).map((participant) => [
        participant.id,
        participant,
      ]),
    );

    const missingIds = [
      ...new Set(
        userIds.filter(
          (userId): userId is string =>
            typeof userId === 'string' &&
            userId.length > 0 &&
            !usersById.has(userId),
        ),
      ),
    ];

    if (missingIds.length === 0) {
      return usersById;
    }

    const users = await this.userRepository.find({
      where: { id: In(missingIds) },
      select: ['id', 'displayName', 'email'],
    });

    users.forEach((user) => {
      usersById.set(user.id, user);
    });

    return usersById;
  }

  private resolveDisplayName(
    user: Pick<User, 'displayName' | 'email'>,
  ): string | null {
    const displayName = (user.displayName ?? '').trim();
    if (displayName.length > 0) {
      return displayName;
    }

    const emailPrefix = (user.email ?? '').split('@')[0]?.trim() ?? '';
    return emailPrefix.length > 0 ? emailPrefix : null;
  }

  private sortByCreatedDesc<
    T extends {
      createdAt: string;
      id: string;
    },
  >(items: T[]): T[] {
    return [...items].sort((left, right) => {
      const byCreatedAt =
        Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (byCreatedAt !== 0) {
        return byCreatedAt;
      }

      return right.id.localeCompare(left.id);
    });
  }

  private sortByCreatedAsc<
    T extends {
      createdAt: string;
      id: string;
    },
  >(items: T[]): T[] {
    return [...items].sort((left, right) => {
      const byCreatedAt =
        Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (byCreatedAt !== 0) {
        return byCreatedAt;
      }

      return left.id.localeCompare(right.id);
    });
  }
}
