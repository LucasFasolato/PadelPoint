import { ChallengeInviteStatus } from '@core/challenges/entities/challenge-invite.entity';
import { ChallengeStatus } from '@core/challenges/enums/challenge-status.enum';
import { ChallengeType } from '@core/challenges/enums/challenge-type.enum';
import { MatchResultStatus } from '@core/matches/entities/match-result.entity';
import { MatchType } from '@core/matches/enums/match-type.enum';
import {
  mapChallengeIntent,
  mapFindPartnerIntent,
  mapPendingConfirmationIntent,
} from './match-intents.mapper';

const USER_ID = 'a1111111-1111-4111-a111-111111111111';

describe('MatchIntentsMapper', () => {
  it('maps CHALLENGE source (DIRECT)', () => {
    const result = mapChallengeIntent(
      {
        id: 'challenge-1',
        type: ChallengeType.DIRECT,
        status: ChallengeStatus.PENDING,
        matchType: MatchType.COMPETITIVE,
        createdAt: '2026-02-27T10:00:00.000Z',
        teamA1Id: 'creator-1',
        invitedOpponentId: USER_ID,
        teamA1: { id: 'creator-1', displayName: 'Creator', email: null },
        invitedOpponent: { id: USER_ID, displayName: 'Me', email: null },
        location: { cityName: 'Cordoba', provinceCode: 'X' },
      },
      USER_ID,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceType: 'CHALLENGE',
        intentType: 'DIRECT',
        mode: 'COMPETITIVE',
        status: 'PENDING',
        myRole: 'INVITEE',
        opponentName: 'Creator',
        cta: { primary: 'Aceptar', href: '/challenges/challenge-1' },
      }),
    );
  });

  it('maps OPEN_CHALLENGE source', () => {
    const result = mapChallengeIntent(
      {
        id: 'open-1',
        type: ChallengeType.OPEN,
        status: ChallengeStatus.ACCEPTED,
        matchType: MatchType.FRIENDLY,
        createdAt: '2026-02-27T10:00:00.000Z',
        teamA1Id: USER_ID,
        teamA1: { id: USER_ID, displayName: 'Me', email: null },
      },
      USER_ID,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceType: 'OPEN_CHALLENGE',
        intentType: 'FIND_OPPONENT',
        mode: 'FRIENDLY',
        status: 'ACCEPTED',
        myRole: 'CREATOR',
      }),
    );
  });

  it('maps PENDING_CONFIRMATION source', () => {
    const result = mapPendingConfirmationIntent(
      {
        id: 'match-1',
        status: MatchResultStatus.PENDING_CONFIRM,
        matchType: MatchType.COMPETITIVE,
        createdAt: '2026-02-27T10:00:00.000Z',
        reportedByUserId: 'other-player',
        challenge: {
          type: ChallengeType.DIRECT,
          teamA1Id: USER_ID,
          teamA1: { id: USER_ID, displayName: 'Me', email: null },
          teamB1: { id: 'other-player', displayName: 'Opponent', email: null },
        },
      },
      USER_ID,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceType: 'PENDING_CONFIRMATION',
        intentType: 'DIRECT',
        status: 'PENDING',
        matchId: 'match-1',
        cta: { primary: 'Confirmar', href: '/matches/match-1' },
      }),
    );
  });

  it('maps FIND_PARTNER source', () => {
    const result = mapFindPartnerIntent(
      {
        id: 'invite-1',
        status: ChallengeInviteStatus.ACCEPTED,
        createdAt: '2026-02-27T10:00:00.000Z',
        inviterId: USER_ID,
        inviteeId: 'invitee-1',
        inviter: { id: USER_ID, displayName: 'Me', email: null },
        invitee: { id: 'invitee-1', displayName: 'Partner', email: null },
        challengeId: 'challenge-2',
        matchId: 'match-2',
        challenge: {
          type: ChallengeType.OPEN,
          matchType: MatchType.COMPETITIVE,
          teamB1: { id: 'opp-1', displayName: 'Opponent', email: null },
          teamA1: { id: USER_ID, displayName: 'Me', email: null },
        },
      },
      USER_ID,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceType: 'FIND_PARTNER',
        intentType: 'FIND_PARTNER',
        status: 'MATCH_CREATED',
        partnerName: 'Partner',
        opponentName: 'Opponent',
        cta: { primary: 'Ver', href: '/matches?challengeId=challenge-2' },
      }),
    );
  });
});
