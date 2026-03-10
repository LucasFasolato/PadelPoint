import { ChallengeScheduleProposalStatus } from '../../../challenges/enums/challenge-schedule-proposal-status.enum';
import { MatchProposal } from '../../entities/match-proposal.entity';
import { mapEntityToMatchProposalResponse } from '../../mappers/match-proposal.mapper';

describe('mapEntityToMatchProposalResponse', () => {
  it('maps the canonical proposal shape without extra fields', () => {
    const entity = {
      id: 'proposal-1',
      proposedByUserId: 'user-1',
      scheduledAt: new Date('2026-03-09T18:00:00.000Z'),
      locationLabel: 'Club Norte',
      clubId: 'club-1',
      courtId: 'court-1',
      note: 'bring balls',
      status: ChallengeScheduleProposalStatus.ACCEPTED,
      createdAt: new Date('2026-03-08T12:00:00.000Z'),
      updatedAt: new Date('2026-03-08T13:00:00.000Z'),
    } as MatchProposal;

    expect(mapEntityToMatchProposalResponse(entity)).toEqual({
      id: 'proposal-1',
      proposedByUserId: 'user-1',
      scheduledAt: '2026-03-09T18:00:00.000Z',
      locationLabel: 'Club Norte',
      clubId: 'club-1',
      courtId: 'court-1',
      note: 'bring balls',
      status: ChallengeScheduleProposalStatus.ACCEPTED,
      createdAt: '2026-03-08T12:00:00.000Z',
      updatedAt: '2026-03-08T13:00:00.000Z',
    });
  });
});
