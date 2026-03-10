import { Repository } from 'typeorm';
import { ActivityFeedService } from './activity-feed.service';
import { UserNotification } from '../entities/user-notification.entity';
import { UserNotificationType } from '../enums/user-notification-type.enum';

describe('ActivityFeedService', () => {
  const makeRepo = (rows: UserNotification[]) => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };

    return {
      repo: {
        createQueryBuilder: jest.fn(() => qb),
      } as unknown as Repository<UserNotification>,
      qb,
    };
  };

  it('maps challenge and ranking events to activity feed types', async () => {
    const createdAt = new Date('2026-02-27T03:00:00.000Z');
    const { repo } = makeRepo([
      {
        id: 'n1',
        userId: 'u1',
        type: UserNotificationType.CHALLENGE_RECEIVED,
        title: 'New challenge',
        body: 'You received a challenge.',
        data: { challengeId: 'c1' },
        readAt: null,
        createdAt,
      } as UserNotification,
      {
        id: 'n2',
        userId: null,
        type: UserNotificationType.RANKING_SNAPSHOT_PUBLISHED,
        title: 'Ranking snapshot published',
        body: null,
        data: { snapshotId: 's1', totalPlayers: 10 },
        readAt: null,
        createdAt: new Date('2026-02-27T02:59:00.000Z'),
      } as UserNotification,
    ]);

    const service = new ActivityFeedService(repo);
    const result = await service.listForUser('u1', { limit: 20 });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        type: 'CHALLENGE_CREATED',
        isGlobal: false,
      }),
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        type: 'RANKING_SNAPSHOT_PUBLISHED',
        isGlobal: true,
      }),
    );
  });
});
