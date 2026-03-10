import { MatchMessage } from '../../entities/match-message.entity';
import { mapEntityToMatchMessageResponse } from '../../mappers/match-message.mapper';

describe('mapEntityToMatchMessageResponse', () => {
  it('maps the canonical message shape without extra fields', () => {
    const entity = {
      id: 'message-1',
      senderUserId: 'user-7',
      message: 'Can we play 20 minutes later?',
      createdAt: new Date('2026-03-09T10:30:00.000Z'),
    } as MatchMessage;

    expect(mapEntityToMatchMessageResponse(entity)).toEqual({
      id: 'message-1',
      senderUserId: 'user-7',
      message: 'Can we play 20 minutes later?',
      createdAt: '2026-03-09T10:30:00.000Z',
    });
  });
});
