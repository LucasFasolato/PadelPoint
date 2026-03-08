import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ParticipantDto,
  TeamsDto,
} from '@/modules/core/matches/dto/match-view.dto';
import { ScoreDto } from '@/modules/core/matches/dto/score.dto';

export class InboxSectionErrorDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  errorId!: string;
}

export class PendingConfirmationInboxItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty({ enum: ['PENDING_CONFIRMATION'] })
  status!: 'PENDING_CONFIRMATION';

  @ApiProperty({
    deprecated: true,
    description:
      'Legacy singles-friendly opponent label derived relative to the viewer.',
  })
  opponentName!: string;

  @ApiPropertyOptional({ nullable: true, deprecated: true })
  opponentAvatarUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  leagueId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  leagueName?: string | null;

  @ApiPropertyOptional()
  playedAt?: string;

  @ApiProperty({ type: TeamsDto })
  teams!: TeamsDto;

  @ApiProperty({ type: [ParticipantDto] })
  participants!: ParticipantDto[];

  @ApiProperty({ type: ScoreDto })
  score!: ScoreDto;

  @ApiPropertyOptional({
    nullable: true,
    deprecated: true,
    description: 'Legacy string projection. Mirrors score.summary.',
  })
  scoreSummary?: string | null;

  @ApiProperty({
    type: 'object',
    properties: {
      primary: { type: 'string', enum: ['Confirmar', 'Ver'] },
      href: { type: 'string', nullable: true },
    },
  })
  cta!: { primary: 'Confirmar' | 'Ver'; href?: string };
}

export class ChallengeInboxItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  coordinationStatus?: string | null;

  @ApiProperty()
  opponentName!: string;

  @ApiPropertyOptional({ nullable: true })
  message?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  scheduledAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationLabel?: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedAt?: string | null;

  @ApiProperty({
    type: 'object',
    properties: {
      primary: { type: 'string', enum: ['Ver', 'Responder'] },
      href: { type: 'string', nullable: true },
    },
  })
  cta!: { primary: 'Ver' | 'Responder'; href?: string };
}

export class InviteInboxItemDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  leagueId?: string | null;

  @ApiProperty()
  leagueName!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  expiresAt?: string | null;

  @ApiProperty({
    type: 'object',
    properties: {
      primary: { type: 'string', enum: ['Ver'] },
      href: { type: 'string', nullable: true },
    },
  })
  cta!: { primary: 'Ver'; href?: string };
}

export class NotificationInboxItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  body?: string | null;

  @ApiPropertyOptional({ nullable: true })
  readAt?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ nullable: true })
  data?: Record<string, unknown> | null;
}

export class PendingConfirmationsInboxSectionDto {
  @ApiProperty({ type: [PendingConfirmationInboxItemDto] })
  items!: PendingConfirmationInboxItemDto[];

  @ApiPropertyOptional({ type: InboxSectionErrorDto })
  error?: InboxSectionErrorDto;
}

export class ChallengesInboxSectionDto {
  @ApiProperty({ type: [ChallengeInboxItemDto] })
  items!: ChallengeInboxItemDto[];

  @ApiPropertyOptional({ type: InboxSectionErrorDto })
  error?: InboxSectionErrorDto;
}

export class InvitesInboxSectionDto {
  @ApiProperty({ type: [InviteInboxItemDto] })
  items!: InviteInboxItemDto[];

  @ApiPropertyOptional({ type: InboxSectionErrorDto })
  error?: InboxSectionErrorDto;
}

export class NotificationsInboxSectionDto {
  @ApiProperty({ type: [NotificationInboxItemDto] })
  items!: NotificationInboxItemDto[];

  @ApiPropertyOptional({ type: InboxSectionErrorDto })
  error?: InboxSectionErrorDto;
}

export class InboxResponseDto {
  @ApiProperty({ type: PendingConfirmationsInboxSectionDto })
  pendingConfirmations!: PendingConfirmationsInboxSectionDto;

  @ApiProperty({ type: ChallengesInboxSectionDto })
  challenges!: ChallengesInboxSectionDto;

  @ApiProperty({ type: InvitesInboxSectionDto })
  invites!: InvitesInboxSectionDto;

  @ApiProperty({ type: NotificationsInboxSectionDto })
  notifications!: NotificationsInboxSectionDto;
}
