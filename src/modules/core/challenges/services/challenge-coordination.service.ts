import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Club } from '@/modules/legacy/clubs/club.entity';
import { Court } from '@/modules/legacy/courts/court.entity';
import { MatchResult } from '@/modules/core/matches/entities/match-result.entity';
import { UserNotificationType } from '@/modules/core/notifications/enums/user-notification-type.enum';
import { UserNotificationsService } from '@/modules/core/notifications/services/user-notifications.service';
import { ChallengeCoordinationStatus } from '../enums/challenge-coordination-status.enum';
import { ChallengeScheduleProposalStatus } from '../enums/challenge-schedule-proposal-status.enum';
import { ChallengeStatus } from '../enums/challenge-status.enum';
import { ChallengeMessage } from '../entities/challenge-message.entity';
import { ChallengeScheduleProposal } from '../entities/challenge-schedule-proposal.entity';
import { Challenge } from '../entities/challenge.entity';
import { CreateChallengeMessageDto } from '../dto/create-challenge-message.dto';
import { CreateChallengeProposalDto } from '../dto/create-challenge-proposal.dto';
import {
  ChallengeCoordinationResponseDto,
  ChallengeCoordinationUserDto,
  ChallengeMessageResponseDto,
  ChallengeProposalResponseDto,
  ChallengeScheduleResponseDto,
} from '../dto/challenge-coordination-response.dto';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class ChallengeCoordinationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly userNotifications: UserNotificationsService,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(ChallengeScheduleProposal)
    private readonly proposalRepo: Repository<ChallengeScheduleProposal>,
    @InjectRepository(ChallengeMessage)
    private readonly messageRepo: Repository<ChallengeMessage>,
    @InjectRepository(MatchResult)
    private readonly matchRepo: Repository<MatchResult>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Club)
    private readonly clubRepo: Repository<Club>,
    @InjectRepository(Court)
    private readonly courtRepo: Repository<Court>,
  ) {}

  async getCoordinationState(
    challengeId: string,
    userId: string,
  ): Promise<ChallengeCoordinationResponseDto> {
    return this.loadCoordinationState(challengeId, userId);
  }

  async listMessages(
    challengeId: string,
    userId: string,
  ): Promise<ChallengeMessageResponseDto[]> {
    const challenge = await this.getChallengeOrThrow(challengeId);
    this.assertParticipantOrThrow(challenge, userId);

    const messages = await this.messageRepo.find({
      where: { challengeId },
      relations: ['sender'],
      order: { createdAt: 'ASC', id: 'ASC' },
      take: 100,
    });

    return messages.map((message) => this.toMessageDto(message));
  }

  async createProposal(
    challengeId: string,
    userId: string,
    dto: CreateChallengeProposalDto,
  ): Promise<ChallengeCoordinationResponseDto> {
    const location = await this.resolveLocation(dto);
    const scheduledAt = this.parseScheduledAt(dto.scheduledAt);
    const note = this.normalizeOptionalString(dto.note);

    await this.dataSource.transaction(async (manager) => {
      const challengeRepo = manager.getRepository(Challenge);
      const proposalRepo = manager.getRepository(ChallengeScheduleProposal);

      const challenge = await challengeRepo
        .createQueryBuilder('challenge')
        .setLock('pessimistic_write')
        .where('challenge.id = :id', { id: challengeId })
        .getOne();

      if (!challenge) {
        throw new NotFoundException('Challenge not found');
      }

      this.assertParticipantOrThrow(challenge, userId);
      this.assertCoordinationWritable(challenge);
      if (
        this.resolveCoordinationStatus(challenge) ===
        ChallengeCoordinationStatus.SCHEDULED
      ) {
        throw new ConflictException('Challenge is already scheduled');
      }

      const currentPending = await proposalRepo.findOne({
        where: {
          challengeId,
          status: ChallengeScheduleProposalStatus.PENDING,
        },
        order: { createdAt: 'DESC', id: 'DESC' },
      });

      if (currentPending) {
        currentPending.status = ChallengeScheduleProposalStatus.COUNTERED;
        await proposalRepo.save(currentPending);
      }

      const proposal = proposalRepo.create({
        challengeId,
        proposedByUserId: userId,
        scheduledAt,
        locationLabel: location.locationLabel,
        clubId: location.club?.id ?? null,
        courtId: location.court?.id ?? null,
        note,
        status: ChallengeScheduleProposalStatus.PENDING,
      });
      await proposalRepo.save(proposal);

      challenge.coordinationStatus = ChallengeCoordinationStatus.COORDINATING;
      await challengeRepo.save(challenge);
    });

    await this.notifyOtherParticipants(challengeId, userId, {
      title: 'New match proposal',
      body: `${await this.resolveActorName(userId)} proposed a schedule.`,
      data: {
        event: 'challenge.coordination.proposal_received',
        challengeId,
        link: `/challenges/${challengeId}`,
      },
    });

    return this.loadCoordinationState(challengeId, userId);
  }

  async acceptProposal(
    challengeId: string,
    proposalId: string,
    userId: string,
  ): Promise<ChallengeCoordinationResponseDto> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const challengeRepo = manager.getRepository(Challenge);
      const proposalRepo = manager.getRepository(ChallengeScheduleProposal);
      const matchRepo = manager.getRepository(MatchResult);

      const challenge = await challengeRepo
        .createQueryBuilder('challenge')
        .setLock('pessimistic_write')
        .where('challenge.id = :id', { id: challengeId })
        .getOne();

      if (!challenge) {
        throw new NotFoundException('Challenge not found');
      }

      this.assertParticipantOrThrow(challenge, userId);
      this.assertCoordinationWritable(challenge);

      const proposal = await proposalRepo
        .createQueryBuilder('proposal')
        .setLock('pessimistic_write')
        .where('proposal.id = :proposalId', { proposalId })
        .andWhere('proposal."challengeId" = :challengeId', { challengeId })
        .getOne();

      if (!proposal) {
        throw new NotFoundException('Proposal not found');
      }
      if (proposal.proposedByUserId === userId) {
        throw new BadRequestException('You cannot accept your own proposal');
      }
      if (proposal.status === ChallengeScheduleProposalStatus.ACCEPTED) {
        return false;
      }
      if (proposal.status !== ChallengeScheduleProposalStatus.PENDING) {
        throw new ConflictException('Proposal is not pending');
      }

      proposal.status = ChallengeScheduleProposalStatus.ACCEPTED;
      await proposalRepo.save(proposal);

      await proposalRepo
        .createQueryBuilder()
        .update(ChallengeScheduleProposal)
        .set({ status: ChallengeScheduleProposalStatus.COUNTERED })
        .where('"challengeId" = :challengeId', { challengeId })
        .andWhere('id != :proposalId', { proposalId })
        .andWhere('status = :status', {
          status: ChallengeScheduleProposalStatus.PENDING,
        })
        .execute();

      challenge.coordinationStatus = ChallengeCoordinationStatus.SCHEDULED;
      challenge.scheduledAt = proposal.scheduledAt;
      challenge.locationLabel = proposal.locationLabel;
      challenge.clubId = proposal.clubId;
      challenge.courtId = proposal.courtId;
      await challengeRepo.save(challenge);

      const match = await matchRepo.findOne({
        where: { challengeId },
        select: ['id', 'scheduledAt'],
      });
      if (match) {
        match.scheduledAt = proposal.scheduledAt;
        await matchRepo.save(match);
      }

      return true;
    });

    if (changed) {
      await this.notifyOtherParticipants(challengeId, userId, {
        title: 'Match scheduled',
        body: `${await this.resolveActorName(userId)} accepted the schedule proposal.`,
        data: {
          event: 'challenge.coordination.proposal_accepted',
          challengeId,
          proposalId,
          link: `/challenges/${challengeId}`,
        },
      });
    }

    return this.loadCoordinationState(challengeId, userId);
  }

  async rejectProposal(
    challengeId: string,
    proposalId: string,
    userId: string,
  ): Promise<ChallengeCoordinationResponseDto> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const challengeRepo = manager.getRepository(Challenge);
      const proposalRepo = manager.getRepository(ChallengeScheduleProposal);

      const challenge = await challengeRepo
        .createQueryBuilder('challenge')
        .setLock('pessimistic_write')
        .where('challenge.id = :id', { id: challengeId })
        .getOne();

      if (!challenge) {
        throw new NotFoundException('Challenge not found');
      }

      this.assertParticipantOrThrow(challenge, userId);
      this.assertCoordinationWritable(challenge);

      const proposal = await proposalRepo
        .createQueryBuilder('proposal')
        .setLock('pessimistic_write')
        .where('proposal.id = :proposalId', { proposalId })
        .andWhere('proposal."challengeId" = :challengeId', { challengeId })
        .getOne();

      if (!proposal) {
        throw new NotFoundException('Proposal not found');
      }
      if (proposal.proposedByUserId === userId) {
        throw new BadRequestException('You cannot reject your own proposal');
      }
      if (proposal.status === ChallengeScheduleProposalStatus.REJECTED) {
        return false;
      }
      if (proposal.status !== ChallengeScheduleProposalStatus.PENDING) {
        throw new ConflictException('Proposal is not pending');
      }

      proposal.status = ChallengeScheduleProposalStatus.REJECTED;
      await proposalRepo.save(proposal);

      if (
        this.resolveCoordinationStatus(challenge) !==
        ChallengeCoordinationStatus.SCHEDULED
      ) {
        challenge.coordinationStatus = ChallengeCoordinationStatus.COORDINATING;
        await challengeRepo.save(challenge);
      }

      return true;
    });

    if (changed) {
      await this.notifyOtherParticipants(challengeId, userId, {
        title: 'Proposal rejected',
        body: `${await this.resolveActorName(userId)} rejected the schedule proposal.`,
        data: {
          event: 'challenge.coordination.proposal_rejected',
          challengeId,
          proposalId,
          link: `/challenges/${challengeId}`,
        },
      });
    }

    return this.loadCoordinationState(challengeId, userId);
  }

  async createMessage(
    challengeId: string,
    userId: string,
    dto: CreateChallengeMessageDto,
  ): Promise<ChallengeMessageResponseDto> {
    const normalizedMessage = this.normalizeRequiredString(dto.message, 500);

    const message = await this.dataSource.transaction(async (manager) => {
      const challengeRepo = manager.getRepository(Challenge);
      const messageRepo = manager.getRepository(ChallengeMessage);

      const challenge = await challengeRepo
        .createQueryBuilder('challenge')
        .setLock('pessimistic_write')
        .where('challenge.id = :id', { id: challengeId })
        .getOne();

      if (!challenge) {
        throw new NotFoundException('Challenge not found');
      }

      this.assertParticipantOrThrow(challenge, userId);
      this.assertCoordinationWritable(challenge);

      const created = messageRepo.create({
        challengeId,
        senderUserId: userId,
        message: normalizedMessage,
      });
      const saved = await messageRepo.save(created);

      if (
        this.resolveCoordinationStatus(challenge) !==
        ChallengeCoordinationStatus.SCHEDULED
      ) {
        challenge.coordinationStatus = ChallengeCoordinationStatus.COORDINATING;
        await challengeRepo.save(challenge);
      }

      return saved;
    });

    await this.notifyOtherParticipants(challengeId, userId, {
      title: 'New coordination message',
      body: `${await this.resolveActorName(userId)} sent a coordination message.`,
      data: {
        event: 'challenge.coordination.message_received',
        challengeId,
        link: `/challenges/${challengeId}`,
      },
    });

    const hydrated = await this.messageRepo.findOne({
      where: { id: message.id },
      relations: ['sender'],
    });
    if (!hydrated) {
      throw new NotFoundException('Message not found');
    }
    return this.toMessageDto(hydrated);
  }

  private async loadCoordinationState(
    challengeId: string,
    userId: string,
  ): Promise<ChallengeCoordinationResponseDto> {
    const challenge = await this.getChallengeOrThrow(challengeId);
    this.assertParticipantOrThrow(challenge, userId);

    const [proposals, messages, match] = await Promise.all([
      this.proposalRepo.find({
        where: { challengeId },
        relations: ['proposedBy', 'club', 'court'],
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 20,
      }),
      this.messageRepo.find({
        where: { challengeId },
        relations: ['sender'],
        order: { createdAt: 'ASC', id: 'ASC' },
        take: 50,
      }),
      this.matchRepo.findOne({
        where: { challengeId },
        select: ['id'],
      }),
    ]);

    const pendingProposal =
      proposals.find(
        (proposal) =>
          proposal.status === ChallengeScheduleProposalStatus.PENDING,
      ) ?? null;
    const acceptedProposal =
      proposals.find(
        (proposal) =>
          proposal.status === ChallengeScheduleProposalStatus.ACCEPTED,
      ) ?? null;
    const acceptedSchedule = acceptedProposal
      ? this.toScheduleDto(acceptedProposal)
      : challenge.scheduledAt
        ? {
            scheduledAt: challenge.scheduledAt.toISOString(),
            locationLabel: challenge.locationLabel,
            clubId: challenge.clubId,
            clubName: challenge.club?.nombre ?? null,
            courtId: challenge.courtId,
            courtName: challenge.court?.nombre ?? null,
            note: null,
          }
        : null;

    return {
      challengeId: challenge.id,
      challengeStatus: challenge.status,
      coordinationStatus: this.resolveCoordinationStatus(challenge),
      matchType: challenge.matchType,
      matchId: match?.id ?? null,
      participants: this.getParticipants(challenge).map((participant) =>
        this.toRequiredUserDto(participant),
      ),
      opponent: this.resolveOpponent(challenge, userId),
      acceptedSchedule,
      pendingProposal: pendingProposal
        ? this.toProposalDto(pendingProposal)
        : null,
      proposals: proposals.map((proposal) => this.toProposalDto(proposal)),
      messages: messages.map((message) => this.toMessageDto(message)),
    };
  }

  private async getChallengeOrThrow(challengeId: string): Promise<Challenge> {
    const challenge = await this.challengeRepo.findOne({
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

  private assertCoordinationWritable(challenge: Challenge): void {
    if (
      ![ChallengeStatus.ACCEPTED, ChallengeStatus.READY].includes(
        challenge.status,
      )
    ) {
      throw new BadRequestException('Challenge is not ready for coordination');
    }
  }

  private resolveCoordinationStatus(
    challenge: Pick<Challenge, 'status' | 'coordinationStatus' | 'scheduledAt'>,
  ): ChallengeCoordinationStatus | null {
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

  private parseScheduledAt(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid scheduledAt');
    }
    return parsed;
  }

  private async resolveLocation(dto: CreateChallengeProposalDto): Promise<{
    locationLabel: string | null;
    club: Club | null;
    court: Court | null;
  }> {
    const locationLabel = this.normalizeOptionalString(dto.locationLabel);
    let club: Club | null = null;
    let court: Court | null = null;

    if (dto.clubId) {
      club = await this.clubRepo.findOne({
        where: { id: dto.clubId },
      });
      if (!club) {
        throw new NotFoundException('Club not found');
      }
    }

    if (dto.courtId) {
      court = await this.courtRepo.findOne({
        where: { id: dto.courtId },
        relations: ['club'],
      });
      if (!court) {
        throw new NotFoundException('Court not found');
      }
      if (club && court.club?.id !== club.id) {
        throw new BadRequestException(
          'Court does not belong to the selected club',
        );
      }
      club = club ?? court.club ?? null;
    }

    if (!locationLabel && !club) {
      throw new BadRequestException('locationLabel or clubId is required');
    }

    return { locationLabel, club, court };
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

  private toScheduleDto(
    proposal: ChallengeScheduleProposal,
  ): ChallengeScheduleResponseDto {
    return {
      scheduledAt: proposal.scheduledAt.toISOString(),
      locationLabel: proposal.locationLabel,
      clubId: proposal.clubId,
      clubName: proposal.club?.nombre ?? null,
      courtId: proposal.courtId,
      courtName: proposal.court?.nombre ?? null,
      note: proposal.note,
    };
  }

  private toProposalDto(
    proposal: ChallengeScheduleProposal,
  ): ChallengeProposalResponseDto {
    return {
      id: proposal.id,
      status: proposal.status,
      proposedBy: this.toRequiredUserDto(proposal.proposedBy),
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
      ...this.toScheduleDto(proposal),
    };
  }

  private toMessageDto(message: ChallengeMessage): ChallengeMessageResponseDto {
    return {
      id: message.id,
      message: message.message,
      sender: this.toRequiredUserDto(message.sender),
      createdAt: message.createdAt.toISOString(),
    };
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

  private normalizeOptionalString(value: string | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeRequiredString(value: string, maxLength: number): string {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('message is required');
    }
    if (trimmed.length > maxLength) {
      throw new BadRequestException('message is too long');
    }
    return trimmed;
  }

  private async resolveActorName(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'displayName', 'email'],
    });
    return user ? (this.resolveDisplayName(user) ?? 'A player') : 'A player';
  }

  private async notifyOtherParticipants(
    challengeId: string,
    actorUserId: string,
    notification: {
      title: string;
      body: string;
      data: Record<string, unknown>;
    },
  ): Promise<void> {
    const challenge = await this.getChallengeOrThrow(challengeId);
    const recipients = this.getParticipants(challenge)
      .map((participant) => participant.id)
      .filter((participantId) => participantId !== actorUserId);

    await Promise.all(
      [...new Set(recipients)].map((recipientId) =>
        this.userNotifications.create({
          userId: recipientId,
          type: UserNotificationType.SYSTEM,
          title: notification.title,
          body: notification.body,
          data: notification.data,
        }),
      ),
    );
  }
}
