import dataSource from '@db/typeorm.datasource';
import { UserNotification } from '@/modules/core/notifications/entities/user-notification.entity';
import { UserNotificationType } from '@/modules/core/notifications/enums/user-notification-type.enum';

async function run() {
  const userId = process.argv[2];
  if (!userId) {
    throw new Error(
      'Usage: ts-node src/scripts/seed-activity-feed.ts <userId>',
    );
  }

  await dataSource.initialize();
  const repo = dataSource.getRepository(UserNotification);

  const now = Date.now();
  await repo.insert([
    {
      userId: null,
      type: UserNotificationType.RANKING_SNAPSHOT_PUBLISHED,
      title: 'Ranking snapshot published',
      body: 'Ranking updated for province scope',
      data: {
        snapshotId: 'local-seed-snapshot',
        scope: 'PROVINCE',
        category: '7ma',
        timeframe: 'CURRENT_SEASON',
        mode: 'COMPETITIVE',
        totalPlayers: 42,
      },
      readAt: null,
      createdAt: new Date(now - 5 * 60 * 1000),
    },
    {
      userId,
      type: UserNotificationType.RANKING_MOVEMENT,
      title: 'You moved up 3 positions',
      body: 'Now ranked #12',
      data: {
        snapshotId: 'local-seed-snapshot',
        deltaPositions: 3,
        oldPosition: 15,
        newPosition: 12,
        rating: 1310,
        scope: 'PROVINCE',
        category: '7ma',
        link: '/rankings',
      },
      readAt: null,
      createdAt: new Date(now - 4 * 60 * 1000),
    },
    {
      userId,
      type: UserNotificationType.MATCH_CONFIRMED,
      title: 'Match confirmed',
      body: 'A player confirmed the match result.',
      data: {
        matchId: 'seed-match',
        link: '/matches/seed-match',
      },
      readAt: null,
      createdAt: new Date(now - 3 * 60 * 1000),
    },
    {
      userId,
      type: UserNotificationType.CHALLENGE_RECEIVED,
      title: 'New challenge',
      body: 'You received a challenge.',
      data: {
        challengeId: 'seed-challenge',
        link: '/challenges/seed-challenge',
      },
      readAt: null,
      createdAt: new Date(now - 2 * 60 * 1000),
    },
  ]);

  await dataSource.destroy();

  console.log(`Seeded activity feed notifications for userId=${userId}`);
}

run().catch(async (err) => {
  console.error(err);
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
  process.exit(1);
});
