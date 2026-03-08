import { ChallengeInviteStatus } from '@core/challenges/entities/challenge-invite.entity';
import { ChallengeCoordinationStatus } from '@core/challenges/enums/challenge-coordination-status.enum';
import { ChallengeStatus } from '@core/challenges/enums/challenge-status.enum';
import { ChallengeType } from '@core/challenges/enums/challenge-type.enum';
import { MatchResultStatus } from '@core/matches/entities/match-result.entity';
import { MatchType } from '@core/matches/enums/match-type.enum';

export const FIND_PARTNER_MESSAGE_MARKER = '[INTENT:FIND_PARTNER]';

export type MatchIntentSourceType =
  | 'CHALLENGE'
  | 'OPEN_CHALLENGE'
  | 'PENDING_CONFIRMATION'
  | 'FIND_PARTNER';

export type MatchIntentType =
  | 'DIRECT'
  | 'OPEN'
  | 'FIND_PARTNER'
  | 'FIND_OPPONENT';

export type MatchIntentMode = 'COMPETITIVE' | 'FRIENDLY';

export type MatchIntentStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'MATCH_CREATED';

export type MatchIntentRole = 'CREATOR' | 'INVITEE';

export type MatchIntentItem = {
  id: string;
  sourceType: MatchIntentSourceType;
  intentType: MatchIntentType;
  mode: MatchIntentMode;
  status: MatchIntentStatus;
  createdAt: string;
  expiresAt?: string | null;
  myRole?: MatchIntentRole;
  opponentName?: string | null;
  partnerName?: string | null;
  location?: {
    cityName?: string | null;
    provinceCode?: string | null;
  };
  coordinationStatus?: ChallengeCoordinationStatus | null;
  scheduledAt?: string | null;
  locationLabel?: string | null;
  matchId?: string | null;
  cta: {
    primary: 'Aceptar' | 'Rechazar' | 'Confirmar' | 'Ver' | 'Cargar resultado';
    href?: string;
  };
};

type IntentUserRef = {
  id?: string | null;
  displayName?: string | null;
  email?: string | null;
};

type IntentLocationRef = {
  cityName?: string | null;
  provinceCode?: string | null;
};

export type ChallengeIntentSource = {
  id?: string | null;
  type?: ChallengeType | null;
  status?: ChallengeStatus | null;
  matchType?: MatchType | null;
  createdAt?: Date | string | null;
  teamA1Id?: string | null;
  teamA2Id?: string | null;
  teamB1Id?: string | null;
  teamB2Id?: string | null;
  invitedOpponentId?: string | null;
  teamA1?: IntentUserRef | null;
  teamA2?: IntentUserRef | null;
  teamB1?: IntentUserRef | null;
  teamB2?: IntentUserRef | null;
  invitedOpponent?: IntentUserRef | null;
  message?: string | null;
  location?: IntentLocationRef | null;
  coordinationStatus?: ChallengeCoordinationStatus | null;
  scheduledAt?: Date | string | null;
  locationLabel?: string | null;
  matchId?: string | null;
};

export type PendingConfirmationIntentSource = {
  id?: string | null;
  challengeId?: string | null;
  status?: MatchResultStatus | null;
  matchType?: MatchType | null;
  createdAt?: Date | string | null;
  reportedByUserId?: string | null;
  challenge?: ChallengeIntentSource | null;
};

export type FindPartnerIntentSource = {
  id?: string | null;
  status?: ChallengeInviteStatus | null;
  createdAt?: Date | string | null;
  inviterId?: string | null;
  inviteeId?: string | null;
  inviter?: IntentUserRef | null;
  invitee?: IntentUserRef | null;
  challenge?: ChallengeIntentSource | null;
  challengeId?: string | null;
  matchId?: string | null;
};

export function mapChallengeIntent(
  source: ChallengeIntentSource,
  userId: string,
): MatchIntentItem {
  const challengeId = source.id ?? '';
  const myRole = resolveChallengeRole(source, userId);
  const intentType = resolveChallengeIntentType(source, userId);
  const status = mapChallengeStatus(source.status, source.matchId);
  const opponentAndPartner = resolveChallengeOpponentAndPartner(source, userId);
  const mode = resolveMode(source.matchType);

  return {
    id: challengeId,
    sourceType:
      source.type === ChallengeType.OPEN ? 'OPEN_CHALLENGE' : 'CHALLENGE',
    intentType,
    mode,
    status,
    createdAt: toIsoOrEpoch(source.createdAt),
    expiresAt: null,
    myRole,
    opponentName: opponentAndPartner.opponentName,
    partnerName: opponentAndPartner.partnerName,
    location: source.location ?? {},
    coordinationStatus: source.coordinationStatus ?? null,
    scheduledAt: toIsoOrNull(source.scheduledAt),
    locationLabel: source.locationLabel ?? null,
    matchId: source.matchId ?? null,
    cta: challengeCta(challengeId, status, myRole),
  };
}

export function mapPendingConfirmationIntent(
  source: PendingConfirmationIntentSource,
  userId: string,
): MatchIntentItem {
  const challenge = source.challenge ?? {};
  const opponentAndPartner = resolveChallengeOpponentAndPartner(
    challenge,
    userId,
  );
  const intentType = resolveChallengeIntentType(challenge, userId);
  const status = mapPendingStatus(source.status);
  const matchId = source.id ?? '';

  return {
    id: matchId,
    sourceType: 'PENDING_CONFIRMATION',
    intentType,
    mode: resolveMode(source.matchType ?? challenge.matchType),
    status,
    createdAt: toIsoOrEpoch(source.createdAt),
    expiresAt: null,
    myRole: source.reportedByUserId === userId ? 'CREATOR' : 'INVITEE',
    opponentName: opponentAndPartner.opponentName,
    partnerName: opponentAndPartner.partnerName,
    location: challenge.location ?? {},
    matchId,
    cta: {
      primary: 'Confirmar',
      href: matchId ? `/matches/${matchId}` : undefined,
    },
  };
}

export function mapFindPartnerIntent(
  source: FindPartnerIntentSource,
  userId: string,
): MatchIntentItem {
  const challenge = source.challenge ?? {};
  const status = mapInviteStatus(source.status, source.matchId);
  const myRole = source.inviterId === userId ? 'CREATOR' : 'INVITEE';
  const partnerName =
    myRole === 'CREATOR'
      ? toDisplayName(source.invitee ?? null)
      : toDisplayName(source.inviter ?? null);
  const opponent = resolveOpponentForFindPartner(challenge, myRole);
  const intentId = source.id ?? '';

  return {
    id: intentId,
    sourceType: 'FIND_PARTNER',
    intentType: 'FIND_PARTNER',
    mode: resolveMode(challenge.matchType),
    status,
    createdAt: toIsoOrEpoch(source.createdAt),
    expiresAt: null,
    myRole,
    opponentName: opponent,
    partnerName,
    location: challenge.location ?? {},
    matchId: source.matchId ?? null,
    cta: findPartnerCta(intentId, status, myRole, source.challengeId ?? null),
  };
}

function resolveChallengeRole(
  source: ChallengeIntentSource,
  userId: string,
): MatchIntentRole {
  if (source.teamA1Id === userId || source.teamA2Id === userId)
    return 'CREATOR';
  return 'INVITEE';
}

function resolveChallengeIntentType(
  source: ChallengeIntentSource,
  userId: string,
): MatchIntentType {
  if (source.type === ChallengeType.OPEN) {
    if (
      (source.teamA1Id === userId || source.teamA2Id === userId) &&
      isFindPartnerTaggedMessage(source.message)
    ) {
      return 'FIND_PARTNER';
    }
    if (source.teamA1Id === userId || source.teamA2Id === userId) {
      return 'FIND_OPPONENT';
    }
    return 'OPEN';
  }
  return 'DIRECT';
}

function resolveChallengeOpponentAndPartner(
  source: ChallengeIntentSource,
  userId: string,
): { opponentName: string | null; partnerName: string | null } {
  const isTeamA = source.teamA1Id === userId || source.teamA2Id === userId;
  const isTeamB =
    source.teamB1Id === userId ||
    source.teamB2Id === userId ||
    source.invitedOpponentId === userId;

  if (isTeamA) {
    return {
      opponentName: toDisplayName(
        source.teamB1 ?? source.invitedOpponent ?? null,
      ),
      partnerName: resolvePartnerForTeam(userId, source.teamA1, source.teamA2),
    };
  }

  if (isTeamB) {
    return {
      opponentName: toDisplayName(source.teamA1 ?? null),
      partnerName: resolvePartnerForTeam(userId, source.teamB1, source.teamB2),
    };
  }

  return {
    opponentName: toDisplayName(
      source.teamA1 ?? source.teamB1 ?? source.invitedOpponent ?? null,
    ),
    partnerName: null,
  };
}

function resolvePartnerForTeam(
  userId: string,
  p1?: IntentUserRef | null,
  p2?: IntentUserRef | null,
): string | null {
  if (p1?.id && p1.id !== userId) return toDisplayName(p1);
  if (p2?.id && p2.id !== userId) return toDisplayName(p2);
  return null;
}

function resolveOpponentForFindPartner(
  challenge: ChallengeIntentSource,
  myRole: MatchIntentRole,
): string | null {
  if (myRole === 'CREATOR') {
    return toDisplayName(challenge.teamB1 ?? challenge.invitedOpponent ?? null);
  }
  return toDisplayName(challenge.teamA1 ?? null);
}

function resolveMode(matchType?: MatchType | null): MatchIntentMode {
  return matchType === MatchType.FRIENDLY ? 'FRIENDLY' : 'COMPETITIVE';
}

function mapChallengeStatus(
  status?: ChallengeStatus | null,
  matchId?: string | null,
): MatchIntentStatus {
  if (matchId) return 'MATCH_CREATED';
  if (status === ChallengeStatus.ACCEPTED || status === ChallengeStatus.READY) {
    return 'ACCEPTED';
  }
  if (
    status === ChallengeStatus.REJECTED ||
    status === ChallengeStatus.CANCELLED
  ) {
    return 'DECLINED';
  }
  return 'PENDING';
}

function mapPendingStatus(
  status?: MatchResultStatus | null,
): MatchIntentStatus {
  if (status === MatchResultStatus.PENDING_CONFIRM) return 'PENDING';
  if (status === MatchResultStatus.CONFIRMED) return 'MATCH_CREATED';
  if (
    status === MatchResultStatus.REJECTED ||
    status === MatchResultStatus.DISPUTED ||
    status === MatchResultStatus.RESOLVED
  ) {
    return 'DECLINED';
  }
  return 'ACCEPTED';
}

function mapInviteStatus(
  status?: ChallengeInviteStatus | null,
  matchId?: string | null,
): MatchIntentStatus {
  if (matchId) return 'MATCH_CREATED';
  if (status === ChallengeInviteStatus.ACCEPTED) return 'ACCEPTED';
  if (status === ChallengeInviteStatus.EXPIRED) return 'EXPIRED';
  if (
    status === ChallengeInviteStatus.REJECTED ||
    status === ChallengeInviteStatus.CANCELLED
  ) {
    return 'DECLINED';
  }
  return 'PENDING';
}

function challengeCta(
  challengeId: string,
  status: MatchIntentStatus,
  role: MatchIntentRole,
): MatchIntentItem['cta'] {
  if (status === 'PENDING' && role === 'INVITEE') {
    return {
      primary: 'Aceptar',
      href: challengeId ? `/challenges/${challengeId}` : undefined,
    };
  }
  if (status === 'ACCEPTED') {
    return {
      primary: 'Cargar resultado',
      href: challengeId ? `/matches?challengeId=${challengeId}` : undefined,
    };
  }
  if (status === 'MATCH_CREATED') {
    return {
      primary: 'Ver',
      href: challengeId ? `/matches?challengeId=${challengeId}` : undefined,
    };
  }
  return {
    primary: 'Ver',
    href: challengeId ? `/challenges/${challengeId}` : undefined,
  };
}

function findPartnerCta(
  inviteId: string,
  status: MatchIntentStatus,
  role: MatchIntentRole,
  challengeId: string | null,
): MatchIntentItem['cta'] {
  if (status === 'PENDING' && role === 'INVITEE') {
    return {
      primary: 'Aceptar',
      href: inviteId ? `/challenge-invites/${inviteId}` : undefined,
    };
  }
  if (status === 'ACCEPTED' && challengeId) {
    return {
      primary: 'Cargar resultado',
      href: `/matches?challengeId=${challengeId}`,
    };
  }
  if (status === 'MATCH_CREATED' && challengeId) {
    return {
      primary: 'Ver',
      href: `/matches?challengeId=${challengeId}`,
    };
  }
  return {
    primary: 'Ver',
    href: inviteId ? `/challenge-invites/${inviteId}` : undefined,
  };
}

function toDisplayName(user?: IntentUserRef | null): string | null {
  if (!user) return null;
  const display = (user.displayName ?? '').trim();
  if (display.length > 0) return display;
  const emailPrefix = (user.email ?? '').split('@')[0]?.trim() ?? '';
  return emailPrefix.length > 0 ? emailPrefix : null;
}

function toIsoOrEpoch(value?: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  return parsed.toISOString();
}

function toIsoOrNull(value?: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isFindPartnerTaggedMessage(
  message: string | null | undefined,
): boolean {
  const value = (message ?? '').trim();
  return value.startsWith(FIND_PARTNER_MESSAGE_MARKER);
}
