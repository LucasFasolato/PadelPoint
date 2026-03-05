import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CanonicalNotificationEntityRefsDto {
  @ApiPropertyOptional({ nullable: true })
  leagueId: string | null;

  @ApiPropertyOptional({ nullable: true })
  matchId: string | null;

  @ApiPropertyOptional({ nullable: true })
  challengeId: string | null;

  @ApiPropertyOptional({ nullable: true })
  inviteId: string | null;
}

export class CanonicalNotificationActionDto {
  @ApiProperty({ enum: ['VIEW', 'ACCEPT', 'DECLINE'] })
  type: 'VIEW' | 'ACCEPT' | 'DECLINE';

  @ApiProperty()
  label: string;

  @ApiPropertyOptional()
  href?: string;
}

export class CanonicalNotificationInboxItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  body: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional({ nullable: true })
  readAt: string | null;

  @ApiProperty({
    description:
      'Whether the notification still supports actionable buttons (accept/decline).',
  })
  canAct: boolean;

  @ApiProperty({
    enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'NOT_ACTIONABLE'],
  })
  actionStatus:
    | 'PENDING'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'NOT_ACTIONABLE';

  @ApiProperty({ type: CanonicalNotificationEntityRefsDto })
  entityRefs: CanonicalNotificationEntityRefsDto;

  @ApiPropertyOptional({ type: [CanonicalNotificationActionDto] })
  actions?: CanonicalNotificationActionDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opaque payload preserved for backward compatibility.',
  })
  data?: Record<string, unknown> | null;
}

export class CanonicalNotificationsInboxResponseDto {
  @ApiProperty({ type: [CanonicalNotificationInboxItemDto] })
  items: CanonicalNotificationInboxItemDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;

  @ApiProperty()
  unreadCount: number;
}

export class LegacyNotificationsFeedItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  body: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional({ nullable: true })
  readAt: string | null;

  @ApiPropertyOptional()
  canAct?: boolean;

  @ApiPropertyOptional({
    enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'NOT_ACTIONABLE'],
  })
  actionStatus?:
    | 'PENDING'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'NOT_ACTIONABLE';

  @ApiPropertyOptional({ nullable: true })
  data?: Record<string, unknown> | null;
}

export class LegacyNotificationsFeedResponseDto {
  @ApiProperty({ type: [LegacyNotificationsFeedItemDto] })
  items: LegacyNotificationsFeedItemDto[];

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;
}
